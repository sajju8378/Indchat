# Proguard rules for Simple E2EE Chat
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses

# Preserve models
-keep class com.simplee2ee.chat.data.model.** { *; }
