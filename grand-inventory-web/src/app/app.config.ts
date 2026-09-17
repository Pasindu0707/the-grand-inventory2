import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
    provideRouter,
    withComponentInputBinding,
    withInMemoryScrolling
} from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { provideToastr } from 'ngx-toastr';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { GrandPreset } from './theme';

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(
            appRoutes,
            withComponentInputBinding(),
            withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })
        ),
        provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
        provideAnimationsAsync(),
        providePrimeNG({
            theme: { preset: GrandPreset, options: { darkModeSelector: '.app-dark' } },
            ripple: false
        }),
        provideToastr({
            positionClass: 'toast-bottom-right',
            timeOut: 3200,
            progressBar: false,
            closeButton: true
        })
    ]
};
