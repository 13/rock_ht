import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import Animated, { FadeInDown } from "react-native-reanimated";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type FormData = z.infer<typeof schema>;

export default function LoginScreen() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

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
    }
    // Navigation handled by auth guard in _layout
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-6 py-12">
          {/* Logo */}
          <Animated.View
            entering={FadeInDown.delay(0).duration(400)}
            className="items-center mb-10"
          >
            <Text className="text-5xl mb-3">✨</Text>
            <Text className="text-2xl font-bold text-foreground tracking-tight">
              sisiGo
            </Text>
            <Text className="text-muted-fg text-sm mt-1">
              Build habits that stick
            </Text>
          </Animated.View>

          {/* Form */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="bg-card rounded-2xl border border-border p-5 space-y-4"
          >
            <Text className="text-lg font-semibold text-foreground mb-1">
              Welcome back
            </Text>

            <View className="space-y-1">
              <Text className="text-sm font-medium text-foreground">Email</Text>
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, value, onBlur } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="you@example.com"
                    placeholderTextColor="#6b6b80"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    className="h-11 px-3 rounded-xl border border-border bg-background text-foreground text-sm"
                  />
                )}
              />
              {errors.email && (
                <Text className="text-xs text-red-400">{errors.email.message}</Text>
              )}
            </View>

            <View className="space-y-1">
              <Text className="text-sm font-medium text-foreground">Password</Text>
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, value, onBlur } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="••••••••"
                    placeholderTextColor="#6b6b80"
                    secureTextEntry
                    autoComplete="current-password"
                    className="h-11 px-3 rounded-xl border border-border bg-background text-foreground text-sm"
                  />
                )}
              />
              {errors.password && (
                <Text className="text-xs text-red-400">{errors.password.message}</Text>
              )}
            </View>

            {serverError && (
              <View className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                <Text className="text-sm text-red-400">{serverError}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting}
              className="h-11 rounded-xl bg-primary items-center justify-center mt-2"
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white font-semibold text-sm">Sign in</Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(200).duration(400)}
            className="flex-row justify-center mt-5"
          >
            <Text className="text-muted-fg text-sm">Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text className="text-primary font-medium text-sm">Sign up</Text>
              </TouchableOpacity>
            </Link>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
