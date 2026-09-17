export const environment = {
    production: true,
    // Empty on purpose. In production the Angular bundle and the API are served
    // from the same origin by Caddy (see deploy/Caddyfile): Caddy serves these
    // static files at /, and forwards /api/* and /uploads/* to the API container.
    //
    // So API_BASE resolves to the relative '/api/v1', every request is
    // same-origin, and CORS never enters the picture. Hard-coding a host here
    // would break the moment the domain changed, and would need CORS opened to
    // match.
    apiUrl: ''
};
