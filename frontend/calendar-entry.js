import { supabase } from "./supabase-client.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" })
    .catch(error => console.error("Could not register the Acamics service worker:", error));
}

const { data, error } = await supabase.auth.getSession();
if (error || !data.session) {
  window.location.replace("index.html");
} else {
  document.body.style.visibility = "visible";
  await import("./app.js");
}
