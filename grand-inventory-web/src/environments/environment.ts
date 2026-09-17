export const environment = {
    production: false,
    // Empty base → API_BASE resolves to the relative path '/api/v1', which the
    // Angular dev-server proxy (proxy.conf.json) forwards to http://localhost:3000.
    // This keeps requests same-origin, so there are no CORS errors in dev.
    apiUrl: ''
};
