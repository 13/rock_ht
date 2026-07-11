"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, User, Chrome } from "lucide-react";
import { useSupabase } from "@/providers/supabase-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const { supabase } = useSupabase();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function handleGoogleSignup() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setServerError(error.message);
  }

  async function onSubmit(data: FormData) {
    setServerError(null);
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: data.name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    // Fire-and-forget — don't block signup on email delivery failure
    fetch('/api/email/welcome', { method: 'POST' }).catch(() => {
      // Non-critical — email failure should not block the user
    });

    setSuccess(true);
  }

  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-card border border-border rounded-2xl p-8 text-center"
      >
        <div className="text-4xl mb-4">✉️</div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Check your email
        </h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to your inbox. Click it to activate your
          account.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/5">
        <h1 className="text-xl font-semibold text-foreground mb-1">
          Start your journey
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Create your free account
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                {...register("name")}
                type="text"
                placeholder="Your name"
                autoComplete="name"
                className={cn(
                  "w-full h-10 pl-9 pr-3 rounded-lg border bg-background text-sm",
                  "placeholder:text-muted-foreground text-foreground",
                  "transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  errors.name
                    ? "border-destructive"
                    : "border-input hover:border-muted-foreground/50"
                )}
              />
            </div>
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                {...register("email")}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className={cn(
                  "w-full h-10 pl-9 pr-3 rounded-lg border bg-background text-sm",
                  "placeholder:text-muted-foreground text-foreground",
                  "transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  errors.email
                    ? "border-destructive"
                    : "border-input hover:border-muted-foreground/50"
                )}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                {...register("password")}
                type="password"
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                className={cn(
                  "w-full h-10 pl-9 pr-3 rounded-lg border bg-background text-sm",
                  "placeholder:text-muted-foreground text-foreground",
                  "transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  errors.password
                    ? "border-destructive"
                    : "border-input hover:border-muted-foreground/50"
                )}
              />
            </div>
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              <p className="text-sm text-destructive">{serverError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "w-full h-10 rounded-lg text-sm font-semibold transition-all",
              "bg-primary text-primary-foreground",
              "hover:opacity-90 active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "flex items-center justify-center gap-2"
            )}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignup}
        >
          <Chrome className="mr-2 h-4 w-4" />
          Continue with Google
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground mt-4">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-primary font-medium hover:underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </motion.div>
  );
}
