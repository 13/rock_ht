import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PRESET_ICONS, PRESET_COLORS } from "@rock_ht/types";
import { hapticLight } from "@/lib/haptics";
import { requestNotificationPermission } from "@/lib/notifications";
import type { CreateHabitInput, HabitWithFrequency } from "@rock_ht/types";
import { useTheme } from "@/theme/theme-provider";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const schema = z.object({
  title: z.string().min(1, "Title is required").max(80),
  description: z.string().max(200).optional(),
  icon: z.string(),
  color: z.string(),
  frequencyType: z.enum(["daily", "specific_days", "times_per_week"]),
  specificDays: z.array(z.number()).optional(),
  timesPerWeek: z.number().min(1).max(7).optional(),
  reminderEnabled: z.boolean(),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
});

/** Builds a `Date` carrying `HH:mm` as local wall-clock time, for the native time picker. */
function timeStringToDate(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

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
  const { colors } = useTheme();
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
        reminderEnabled: initial?.reminder_enabled ?? false,
        reminderTime: initial?.reminder_time?.slice(0, 5) ?? "09:00",
      },
    });

  const frequencyType = watch("frequencyType");
  const selectedDays = watch("specificDays") ?? [];
  const selectedColor = watch("color");
  const selectedIcon = watch("icon");
  const timesPerWeek = watch("timesPerWeek") ?? 3;
  const reminderEnabled = watch("reminderEnabled");
  const reminderTime = watch("reminderTime");

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notificationHint, setNotificationHint] = useState(false);

  async function handleReminderToggle(value: boolean) {
    hapticLight();
    setValue("reminderEnabled", value);
    if (value) {
      const granted = await requestNotificationPermission();
      setNotificationHint(!granted);
    } else {
      setNotificationHint(false);
    }
  }

  function handleTimeChange(event: DateTimePickerEvent, date?: Date) {
    setShowTimePicker(false);
    if (event.type === "set" && date) {
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      setValue("reminderTime", `${hh}:${mm}`);
    }
  }

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
      reminder_enabled: data.reminderEnabled,
      reminder_time: data.reminderEnabled ? data.reminderTime : undefined,
    });
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
      {/* Title */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary, marginBottom: 6 }}>
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
              placeholderTextColor={colors.textMuted}
              style={{
                backgroundColor: colors.card,
                color: colors.foreground,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 15,
                borderWidth: 1,
                borderColor: colors.elevated,
              }}
              autoFocus
              returnKeyType="next"
            />
          )}
        />
        {formState.errors.title && (
          <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>
            {formState.errors.title.message}
          </Text>
        )}
      </View>

      {/* Description */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary, marginBottom: 6 }}>
          Description{" "}
          <Text style={{ color: colors.textMuted }}>(optional)</Text>
        </Text>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder="What does this habit mean to you?"
              placeholderTextColor={colors.textMuted}
              style={{
                backgroundColor: colors.card,
                color: colors.foreground,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 15,
                borderWidth: 1,
                borderColor: colors.elevated,
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
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary, marginBottom: 6 }}>
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
                backgroundColor: selectedIcon === icon ? selectedColor + "22" : colors.muted,
              }}
            >
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Color */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary, marginBottom: 6 }}>
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
                borderColor: colors.foreground,
              }}
            />
          ))}
        </View>
      </View>

      {/* Frequency */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary, marginBottom: 8 }}>
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
                backgroundColor: frequencyType === opt.value ? selectedColor : colors.muted,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: frequencyType === opt.value ? colors.onPrimary : colors.textSecondary,
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
                    backgroundColor: active ? selectedColor : colors.muted,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: active ? colors.onPrimary : colors.textMuted,
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
                  backgroundColor: timesPerWeek === n ? selectedColor : colors.muted,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: timesPerWeek === n ? colors.onPrimary : colors.textMuted,
                  }}
                >
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Reminder */}
      <View style={{ marginBottom: 20 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "500", color: colors.textSecondary }}>
            Reminder
          </Text>
          <Switch
            value={reminderEnabled}
            onValueChange={handleReminderToggle}
            trackColor={{ false: colors.elevated, true: selectedColor }}
            thumbColor={colors.onPrimary}
          />
        </View>

        {reminderEnabled && (
          <>
            <TouchableOpacity
              onPress={() => {
                hapticLight();
                setShowTimePicker(true);
              }}
              style={{
                marginTop: 10,
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: colors.muted,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                {reminderTime}
              </Text>
            </TouchableOpacity>

            {notificationHint && (
              <Text style={{ color: colors.warning, fontSize: 12, marginTop: 8 }}>
                Enable notifications in your device Settings to receive habit
                reminders.
              </Text>
            )}

            {showTimePicker && (
              <DateTimePicker
                mode="time"
                is24Hour
                value={timeStringToDate(reminderTime)}
                onChange={handleTimeChange}
              />
            )}
          </>
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
            borderColor: colors.elevated,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.textSecondary, fontWeight: "600", fontSize: 15 }}>
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
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Text style={{ color: colors.onPrimary, fontWeight: "600", fontSize: 15 }}>
              {initial ? "Save" : "Create"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
