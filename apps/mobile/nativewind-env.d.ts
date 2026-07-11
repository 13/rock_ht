/// <reference types="nativewind/types" />

// Re-declare NativeWind augmentations against the local react-native copy.
// react-native-css-interop/types.d.ts is a module file so its declare-module
// patches the root node_modules/react-native, not the mobile-local one.
// This file fixes that by augmenting the locally-resolved react-native.
import "react-native";

declare module "react-native" {
  interface ViewProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface TextProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface TextInputProps {
    className?: string;
    placeholderClassName?: string;
    cssInterop?: boolean;
  }
  interface ImageProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface ImageBackgroundProps {
    imageClassName?: string;
    className?: string;
  }
  interface ScrollViewProps {
    className?: string;
    contentContainerClassName?: string;
    indicatorClassName?: string;
    cssInterop?: boolean;
  }
  interface SwitchProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface TouchableWithoutFeedbackProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface KeyboardAvoidingViewProps {
    className?: string;
    contentContainerClassName?: string;
    cssInterop?: boolean;
  }
}
