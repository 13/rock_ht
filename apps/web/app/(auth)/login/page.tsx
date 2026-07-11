"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, Chrome } from "lucide-react";
import { useSupabase } from "@/providers/supabase-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { supabase } = useSupabase();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function handleGoogleLogin() {
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
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      setServerError(
        error.message === "Invalid login credentials"
          ? "Incorrect email or password"
          : error.message
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/5">
        <h1 className="text-xl font-semibold text-foreground mb-1">Welcome back</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Password</label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                {...register("password")}
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
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
            {isSubmitting ? "Signing in…" : "Sign in"}
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
          onClick={handleGoogleLogin}
        >
          <Chrome className="mr-2 h-4 w-4" />
          Continue with Google
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground mt-4">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-primary font-medium hover:underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
    </motion.div>
  );
}
