import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PRESET_ICONS, PRESET_COLORS } from "@sisigo/types";
import { hapticLight } from "@/lib/haptics";
import type { CreateHabitInput, HabitWithFrequency } from "@sisigo/types";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const schema = z.object({
  title: z.string().min(1, "Title is required").max(80),
  description: z.string().max(200).optional(),
  icon: z.string(),
  color: z.string(),
  frequencyType: z.enum(["daily", "specific_days", "times_per_week"]),
  specificDays: z.array(z.number()).optional(),
  timesPerWeek: z.number().min(1).max(7).optional(),
});

type FormData = z.infer<typeof schema>;

interface MobileHabitFormProps {
  initial?: HabitWithFrequency;
  onSubmit: (input: CreateHabitInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function MobileHabitForm({
  initial,
  onSubmit,
  onCancel,
  isLoading = false,
}: MobileHabitFormProps) {
  const defaultFreq = initial?.frequency ?? { type: "daily" as const };
  const defaultSpecificDays =
    defaultFreq.type === "specific_days" ? defaultFreq.days : [];
  const defaultTimesPerWeek =
    defaultFreq.type === "times_per_week" ? defaultFreq.count : 3;

  const { control, handleSubmit, watch, setValue, formState } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: {
        title: initial?.title ?? "",
        description: initial?.description ?? "",
        icon: initial?.icon ?? "✨",
        color: initial?.color ?? PRESET_COLORS[0],
        frequencyType: defaultFreq.type,
        specificDays: defaultSpecificDays,
        timesPerWeek: defaultTimesPerWeek,
      },
    });

  const frequencyType = watch("frequencyType");
  const selectedDays = watch("specificDays") ?? [];
  const selectedColor = watch("color");
  const selectedIcon = watch("icon");
  const timesPerWeek = watch("timesPerWeek") ?? 3;

  function toggleDay(dayIndex: number) {
    hapticLight();
    const next = selectedDays.includes(dayIndex)
      ? selectedDays.filter((d) => d !== dayIndex)
      : [...selectedDays, dayIndex];
    setValue("specificDays", next);
  }

  async function submit(data: FormData) {
    let frequency: CreateHabitInput["frequency"];
    if (data.frequencyType === "daily") {
      frequency = { type: "daily" };
    } else if (data.frequencyType === "specific_days") {
      frequency = { type: "specific_days", days: data.specificDays ?? [] };
    } else {
      frequency = { type: "times_per_week", count: data.timesPerWeek ?? 3 };
    }

    await onSubmit({
      title: data.title,
      description: data.description,
      icon: data.icon,
      color: data.color,
      frequency,
    });
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
      {/* Title */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: "#9ca3af", marginBottom: 6 }}>
          Title
        </Text>
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder="e.g. Morning run"
              placeholderTextColor="#4b5563"
              style={{
                backgroundColor: "#111118",
                color: "#f4f4f8",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 15,
                borderWidth: 1,
                borderColor: "#2d2d3a",
              }}
              autoFocus
              returnKeyType="next"
            />
          )}
        />
        {formState.errors.title && (
          <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
            {formState.errors.title.message}
          </Text>
        )}
      </View>

      {/* Description */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: "#9ca3af", marginBottom: 6 }}>
          Description{" "}
          <Text style={{ color: "#6b7280" }}>(optional)</Text>
        </Text>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder="What does this habit mean to you?"
              placeholderTextColor="#4b5563"
              style={{
                backgroundColor: "#111118",
                color: "#f4f4f8",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 15,
                borderWidth: 1,
                borderColor: "#2d2d3a",
                minHeight: 72,
                textAlignVertical: "top",
              }}
              multiline
              numberOfLines={2}
            />
          )}
        />
      </View>

      {/* Icon */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: "#9ca3af", marginBottom: 6 }}>
          Icon
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {PRESET_ICONS.map((icon) => (
            <TouchableOpacity
              key={icon}
              onPress={() => {
                hapticLight();
                setValue("icon", icon);
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: selectedIcon === icon ? selectedColor : "transparent",
                backgroundColor: selectedIcon === icon ? selectedColor + "22" : "#1e1e2a",
              }}
            >
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Color */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: "#9ca3af", marginBottom: 6 }}>
          Color
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {PRESET_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => {
                hapticLight();
                setValue("color", color);
              }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: color,
                borderWidth: selectedColor === color ? 3 : 0,
                borderColor: "white",
              }}
            />
          ))}
        </View>
      </View>

      {/* Frequency */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: "#9ca3af", marginBottom: 8 }}>
          Frequency
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, marginBottom: 12 }}
        >
          {(
            [
              { value: "daily", label: "Every day" },
              { value: "specific_days", label: "Specific days" },
              { value: "times_per_week", label: "Times / week" },
            ] as const
          ).map((opt) => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => {
                hapticLight();
                setValue("frequencyType", opt.value);
              }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: frequencyType === opt.value ? selectedColor : "#1e1e2a",
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: frequencyType === opt.value ? "white" : "#9ca3af",
                }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {frequencyType === "specific_days" && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {DAY_LABELS.map((label, i) => {
              const active = selectedDays.includes(i);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => toggleDay(i)}
                  style={{
                    flex: 1,
                    aspectRatio: 1,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: active ? selectedColor : "#1e1e2a",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: active ? "white" : "#6b7280",
                    }}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {frequencyType === "times_per_week" && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => {
                  hapticLight();
                  setValue("timesPerWeek", n);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: timesPerWeek === n ? selectedColor : "#1e1e2a",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: timesPerWeek === n ? "white" : "#6b7280",
                  }}
                >
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 16 }}>
        <TouchableOpacity
          onPress={onCancel}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#2d2d3a",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#9ca3af", fontWeight: "600", fontSize: 15 }}>
            Cancel
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit(submit)}
          disabled={isLoading}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: selectedColor,
            alignItems: "center",
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={{ color: "white", fontWeight: "600", fontSize: 15 }}>
              {initial ? "Save" : "Create"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
