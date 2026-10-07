import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-reminder-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function secureEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let mismatch = 0;
  for (let i = 0; i < leftBytes.length; i++) mismatch |= leftBytes[i] ^ rightBytes[i];
  return mismatch === 0;
}

type EventRecord = {
  id: number | string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  target_cohort_start_years?: number[] | null;
  lifecycle_status?: string | null;
  owner_id?: string;
};

function eventStart(event: EventRecord) {
  const time = event.start_time ? event.start_time.slice(0, 5) : "09:00";
  return new Date(`${event.start_date}T${time}:00+05:30`);
}

function activeEvent(event: EventRecord, now: Date) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return event.start_date >= today && event.end_date >= today &&
    !["cancelled", "completed"].includes(String(event.lifecycle_status || "").toLowerCase());
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
      const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
      return keys ? JSON.parse(keys).default : undefined;
    })();
    const exportedVapidKeys = Deno.env.get("VAPID_KEYS_JSON");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");
    if (!supabaseUrl || !serviceKey || !exportedVapidKeys || !vapidSubject) {
      return jsonResponse(503, { error: "Reminder server secrets are not configured." });
    }

    const vapidKeys = await webpush.importVapidKeys(JSON.parse(exportedVapidKeys), { extractable: false });
    if (request.method === "GET") {
      return jsonResponse(200, { publicKey: await webpush.exportApplicationServerKey(vapidKeys) });
    }
    if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

    const expectedSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
    const suppliedSecret = request.headers.get("x-reminder-cron-secret") || "";
    if (!expectedSecret || !suppliedSecret || !(await secureEqual(expectedSecret, suppliedSecret))) {
      return jsonResponse(401, { error: "Unauthorized scheduler request." });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date();
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const windowStart = new Date(now.getTime() - 10 * 60 * 1000);
    const { data: preferences, error: preferenceError } = await admin
      .from("reminder_preferences")
      .select("user_id, cohort_start_year, offsets_minutes")
      .eq("enabled", true);
    if (preferenceError) throw preferenceError;
    if (!preferences?.length) return jsonResponse(200, { checked: 0, sent: 0 });

    const userIds = preferences.map(row => row.user_id);
    const [{ data: officialEvents, error: officialError }, { data: personalEvents, error: personalError }] = await Promise.all([
      admin.from("events")
        .select("id,title,start_date,end_date,start_time,target_cohort_start_years,lifecycle_status")
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .limit(2000),
      admin.from("personal_events")
        .select("id,owner_id,title,start_date,end_date,start_time")
        .in("owner_id", userIds)
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .limit(5000),
    ]);
    if (officialError) throw officialError;
    if (personalError) throw personalError;

    const pendingRows = [];
    for (const preference of preferences) {
      const matchingOfficial = (officialEvents || []).filter(event => {
        const targets = Array.isArray(event.target_cohort_start_years)
          ? event.target_cohort_start_years.map(Number)
          : [];
        return targets.length === 0 || targets.includes(Number(preference.cohort_start_year));
      });
      const userEvents: Array<{ event: EventRecord; key: string }> = [
        ...matchingOfficial.map(event => ({ event: event as EventRecord, key: `official:${event.id}` })),
        ...(personalEvents || [])
          .filter(event => event.owner_id === preference.user_id)
          .map(event => ({ event: event as EventRecord, key: `personal:${event.id}` })),
      ];

      for (const { event, key } of userEvents) {
        if (!activeEvent(event, now)) continue;
        const startAt = eventStart(event);
        const configuredOffsets = (preference.offsets_minutes || []).map(Number);
        const offsets = event.start_time
          ? configuredOffsets
          : configuredOffsets.includes(1440) ? [1440] : [];
        for (const offset of offsets) {
          if (![1440, 60].includes(offset)) continue;
          const dueAt = new Date(startAt.getTime() - offset * 60 * 1000);
          if (dueAt < windowStart || dueAt > now) continue;
          pendingRows.push({
            user_id: preference.user_id,
            event_key: key,
            event_title: event.title,
            event_start_at: startAt.toISOString(),
            offset_minutes: offset,
            due_at: dueAt.toISOString(),
            state: "pending",
          });
        }
      }
    }

    let inserted = [];
    if (pendingRows.length) {
      const { data, error } = await admin.from("notification_outbox")
        .upsert(pendingRows, {
          onConflict: "user_id,event_key,event_start_at,offset_minutes",
          ignoreDuplicates: true,
        })
        .select("id,user_id,event_key,event_title,event_start_at,offset_minutes,due_at,state");
      if (error) throw error;
      inserted = data || [];
    }

    if (!inserted.length) return jsonResponse(200, { checked: preferences.length, sent: 0 });
    const insertedUserIds = [...new Set(inserted.map(row => row.user_id))];
    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("endpoint,user_id,p256dh,auth_secret")
      .in("user_id", insertedUserIds);
    if (subscriptionError) throw subscriptionError;
    const byUser = new Map<string, NonNullable<typeof subscriptions>>();
    for (const subscription of subscriptions || []) {
      byUser.set(subscription.user_id, [...(byUser.get(subscription.user_id) || []), subscription]);
    }

    const appServer = await webpush.ApplicationServer.new({
      contactInformation: vapidSubject,
      vapidKeys,
    });
    let sent = 0;
    for (const row of inserted) {
      const userSubscriptions = byUser.get(row.user_id) || [];
      if (!userSubscriptions.length) {
        await admin.from("notification_outbox").update({ state: "failed", last_error: "No active device subscription." }).eq("id", row.id);
        continue;
      }
      const timing = row.offset_minutes === 1440 ? "tomorrow" : "in about an hour";
      const payload = JSON.stringify({
        title: row.event_title,
        body: `Your event is ${timing}. Open Acamics for details.`,
        tag: `acamics-${row.event_key}-${row.offset_minutes}`,
        url: "./calendar.html",
      });
      let delivered = false;
      const errors: string[] = [];
      for (const subscription of userSubscriptions) {
        try {
          const subscriber = appServer.subscribe({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
          });
          await subscriber.pushTextMessage(payload, { ttl: 3600 });
          delivered = true;
        } catch (error) {
          errors.push(error instanceof Error ? error.message.slice(0, 300) : "Push delivery failed.");
          if (typeof (error as { isGone?: unknown })?.isGone === "function" && (error as { isGone: () => boolean }).isGone()) {
            await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          }
        }
      }
      await admin.from("notification_outbox").update(delivered
        ? { state: "sent", sent_at: new Date().toISOString(), last_error: null }
        : { state: "failed", last_error: errors.join("; ").slice(0, 1000) || "Push delivery failed." })
        .eq("id", row.id);
      if (delivered) sent++;
    }
    return jsonResponse(200, { checked: preferences.length, scheduled: pendingRows.length, sent });
  } catch (error) {
    console.error("send-reminders failed:", error);
    return jsonResponse(500, { error: error instanceof Error ? error.message : "Reminder delivery failed." });
  }
});
