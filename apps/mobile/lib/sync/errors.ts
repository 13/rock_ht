/**
 * Sign-up worked, but the server hands out no session until the email address is confirmed (a
 * Supabase project with "Confirm email" on). Nothing was claimed or saved: the user confirms, then
 * signs in. Kept free of native/supabase imports so the settings screen can check for it cheaply.
 */
export class ConfirmEmailError extends Error {
  constructor(message = "Account created. Check your email to confirm it, then sign in.") {
    super(message);
    this.name = "ConfirmEmailError";
  }
}
