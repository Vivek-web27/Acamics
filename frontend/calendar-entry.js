import { supabase } from "./supabase-client.js";

const { data, error } = await supabase.auth.getSession();
if (error || !data.session) {
  window.location.replace("index.html");
} else {
  document.body.style.visibility = "visible";
  await import("./app.js");
}
