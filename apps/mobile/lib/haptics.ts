import * as Haptics from "expo-haptics";

export async function hapticLight() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export async function hapticMedium() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export async function hapticHeavy() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export async function hapticSuccess() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export async function hapticError() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export async function hapticWarning() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export async function hapticSelection() {
  await Haptics.selectionAsync();
}
