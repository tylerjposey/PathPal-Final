const staticExpoConfig = require("./app.json").expo;

module.exports = ({ config }) => ({
  ...staticExpoConfig,
  ...config,
  extra: {
    ...staticExpoConfig.extra,
    ...config.extra,
  },
});