# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# expo-notifications: R8 was obfuscating/stripping members of
# NotificationsService's inner classes, which broke Bundle/Intent
# serialization of notification event data (NotSerializableException:
# org.json.JSONObject) when handling permission grants and notification
# events, hanging the JS promise that awaits the native response.
-keep class expo.modules.notifications.** { *; }
