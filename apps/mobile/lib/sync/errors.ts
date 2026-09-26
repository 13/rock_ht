/**
 * The server hands out no session for this email/password yet (a Supabase project with "Confirm
 * email" on always answers this way for sign-up, whether or not the account already existed —
 * Supabase never reveals that). Nothing was claimed or saved: the user confirms (if this was really
 * a new account), then signs in. Kept free of native/supabase imports so the settings screen can
 * check for it cheaply. The wording is deliberately neutral rather than "Account created" — this
 * response is also what an *existing, already-confirmed* email gets back from Supabase's sign-up
 * endpoint, so claiming a new account was created would be misleading.
 */
export class ConfirmEmailError extends Error {
  constructor(message = "If this is a new account, check your email to confirm it, then sign in.") {
    super(message);
    this.name = "ConfirmEmailError";
  }
}
