import { supabase } from "./supabase-client.js";

const form = document.getElementById("authForm");
const emailInput = document.getElementById("authEmail");
const passwordInput = document.getElementById("authPassword");
const submitButton = document.getElementById("authSubmit");
const message = document.getElementById("authMessage");
const heading = document.getElementById("authHeading");
const subheading = document.getElementById("authSubheading");
const passwordHint = document.getElementById("passwordHint");
const passwordToggle = document.getElementById("togglePassword");
const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];

// The login page is the app's entry point. Signed-in users go straight to the calendar.
const { data: initialSession } = await supabase.auth.getSession();
if (initialSession.session) window.location.replace("calendar.html");

let authMode = "signin";

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
  message.hidden = false;
}

function clearMessage() {
  message.textContent = "";
  message.classList.remove("error");
  message.hidden = true;
}

function setMode(nextMode, { clear = true } = {}) {
  authMode = nextMode === "signup" ? "signup" : "signin";
  const isSignUp = authMode === "signup";

  modeButtons.forEach((button) => {
    const isActive = button.dataset.authMode === authMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  heading.textContent = isSignUp ? "Create your account" : "Welcome back";
  subheading.textContent = isSignUp
    ? "One account for your personal events and campus updates."
    : "Sign in to keep your personal events in sync.";
  submitButton.textContent = isSignUp ? "Create account" : "Sign in";
  passwordInput.autocomplete = isSignUp ? "new-password" : "current-password";
  passwordHint.hidden = !isSignUp;

  if (clear) clearMessage();
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.authMode));
});

passwordToggle.addEventListener("click", () => {
  const revealPassword = passwordInput.type === "password";
  passwordInput.type = revealPassword ? "text" : "password";
  passwordToggle.textContent = revealPassword ? "Hide" : "Show";
  passwordToggle.setAttribute("aria-label", revealPassword ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage("Enter your email address and password to continue.", true);
    return;
  }

  if (emailInput.validity.typeMismatch) {
    showMessage("Enter a valid email address.", true);
    return;
  }

  if (authMode === "signup" && password.length < 6) {
    showMessage("Use a password with at least 6 characters.", true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";

  try {
    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      if (data.session) {
        window.location.assign("calendar.html");
        return;
      }

      showMessage("Account created. Check your email to confirm it, then sign in here.");
      setMode("signin", { clear: false });
      passwordInput.value = "";
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    window.location.assign("calendar.html");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Authentication failed. Please try again.", true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = authMode === "signup" ? "Create account" : "Sign in";
  }
});
