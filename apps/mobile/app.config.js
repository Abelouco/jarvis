// Junta o app.json com o que não pode ir para o repositório (ele é público).
// GOOGLE_SERVICES_JSON: variável de arquivo do EAS (ambiente preview); localmente, o arquivo na pasta.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
