const staticExpoConfig = require("./app.json").expo;

module.exports = ({ config }) => ({
  ...staticExpoConfig,
  ...config,
  extra: {
    ...staticExpoConfig.extra,
    ...config.extra,
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || "",
    clerkProxyUrl: process.env.CLERK_PROXY_URL && process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}${process.env.CLERK_PROXY_URL}`
      : "",
  },
});