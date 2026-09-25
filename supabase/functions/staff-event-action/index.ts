import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(left)));
  const rightBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(right)));
  let difference = 0;
  for (let i = 0; i < leftBytes.length; i++) difference |= leftBytes[i] ^ rightBytes[i];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      (() => {
        const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
        return keys ? JSON.parse(keys).default : undefined;
      })();
    const teacherPassword = Deno.env.get("TEACHER_ACTION_PASSWORD");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Supabase server credentials are not configured." });
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(401, { error: "Sign in first." });

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResult, error: userError } = await adminClient.auth.getUser(token);
    const user = userResult.user;
    if (userError || !user) return jsonResponse(401, { error: "Your session is invalid or expired." });

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const role = profile?.role;
    if (role !== "admin" && role !== "teacher") {
      return jsonResponse(403, { error: "Only admins and teachers can manage official events." });
    }

    const body = await request.json();
    const action = body?.action;
    if (!new Set(["create_official", "delete_official", "postpone_official"]).has(action)) {
      return jsonResponse(400, { error: "Unsupported staff action." });
    }

    if (role === "teacher") {
      if (!teacherPassword) {
        return jsonResponse(503, { error: "The teacher action password is not configured in Supabase Edge Function secrets." });
      }

      const supplied = typeof body.actionPassword === "string" ? body.actionPassword : "";
      const { count, error: attemptsError } = await adminClient
        .from("staff_action_attempts")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("failed_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
      if (attemptsError) throw attemptsError;
      if ((count ?? 0) >= 5) {
        return jsonResponse(429, { error: "Too many failed attempts. Try again in 15 minutes." });
      }

      if (!(await constantTimeEqual(supplied, teacherPassword))) {
        const { error: recordError } = await adminClient
          .from("staff_action_attempts")
          .insert({ user_id: user.id });
        if (recordError) throw recordError;
        return jsonResponse(403, { error: "The teacher action password is incorrect." });
      }

      const { error: clearError } = await adminClient
        .from("staff_action_attempts")
        .delete()
        .eq("user_id", user.id);
      if (clearError) throw clearError;
    }

    if (action === "create_official") {
      const input = body.event ?? {};
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const category = typeof input.category === "string" ? input.category.trim() : "Academic";
      const startDate = input.start_date;
      const endDate = input.end_date || startDate;
      if (!title || title.length > 180) return jsonResponse(400, { error: "Enter an event title of 1–180 characters." });
      if (!isDate(startDate) || !isDate(endDate) || endDate < startDate) {
        return jsonResponse(400, { error: "Enter valid dates; the end date must not precede the start date." });
      }
      if (!category || category.length > 80) return jsonResponse(400, { error: "Choose a valid category." });
      if (input.start_time && !isTime(input.start_time)) return jsonResponse(400, { error: "Enter a valid start time." });
      if (input.end_time && !isTime(input.end_time)) return jsonResponse(400, { error: "Enter a valid end time." });

      const { data, error } = await adminClient.from("events").insert({
        title,
        category,
        event_type: category,
        start_date: startDate,
        end_date: endDate,
        start_time: input.start_time || null,
        end_time: input.end_time || null,
        location: typeof input.location === "string" ? input.location.trim() || "To be announced" : "To be announced",
        location_type: "Physical",
        department: "All Departments",
        academic_year: "2026-27",
        year: "All Years",
        section: "All Sections",
        organizer: "Acamics Staff",
        description: typeof input.description === "string" ? input.description.trim() : "",
        source: "Official Academic Calendar",
        color_theme: typeof input.color_theme === "string" ? input.color_theme : null,
        is_official: true,
        lifecycle_status: "upcoming",
        original_start_date: startDate,
        original_end_date: endDate,
        postponement_history: [],
      }).select("*").single();
      if (error) throw error;
      return jsonResponse(200, { event: data });
    }

    if (action === "delete_official") {
      const id = Number(body.eventId);
      if (!Number.isSafeInteger(id) || id <= 0) return jsonResponse(400, { error: "Invalid event id." });
      const { data, error } = await adminClient.from("events")
        .delete().eq("id", id).eq("is_official", true).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(404, { error: "Official event not found." });
      return jsonResponse(200, { deleted: true });
    }

    const eventId = Number(body.eventId);
    const newStartDate = body.newStartDate;
    const newEndDate = body.newEndDate;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse(400, { error: "Invalid event id." });
    if (!isDate(newStartDate) || !isDate(newEndDate) || newEndDate < newStartDate) {
      return jsonResponse(400, { error: "Enter valid dates; the end date must not precede the start date." });
    }
    if (!reason) return jsonResponse(400, { error: "A postponement reason is required." });

    const { data, error } = await adminClient.rpc("staff_postpone_event", {
      p_actor_id: user.id,
      p_event_id: eventId,
      p_new_start_date: newStartDate,
      p_new_end_date: newEndDate,
      p_reason: reason,
      p_attachment_path: null,
    });
    if (error) throw error;
    return jsonResponse(200, { event: data });
  } catch (error) {
    console.error("staff-event-action failed:", error);
    return jsonResponse(500, { error: error instanceof Error ? error.message : "Staff action failed." });
  }
});
