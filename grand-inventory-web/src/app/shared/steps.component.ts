/**
 * The step header on the screens that ask one question at a time.
 *
 * Three screens in this console take a person through a sequence rather than
 * presenting a form: receiving a delivery, sending stock back to a supplier,
 * and raising a purchase. Each was previously one long page with every field
 * visible at once, which is fine for the person who built it and confusing for
 * the storekeeper who opens it twice a week - the screen gave no clue where to
 * start or how much was left.
 *
 * A done step is a button: going back to change an answer is normal, and
 * hiding the way back is what makes people cancel and start again. Steps ahead
 * are inert, because offering a step you cannot yet complete is a dead end
 * dressed as a choice.
 */
import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Step {
    /** Stable key, used by the parent to decide what to show. */
    key: string;
    label: string;
    /** One line under the heading, saying what this step is for. */
    hint?: string;
}

@Component({
    selector: 'app-steps',
    standalone: true,
    imports: [CommonModule],
    template: `
        <nav class="app-steps" [attr.aria-label]="label()">
            <ol class="app-steps__list">
                @for (step of steps(); track step.key; let i = $index) {
                    <li
                        class="app-steps__step"
                        [class.app-steps__step--on]="i === index()"
                        [class.app-steps__step--done]="i < index()">
                        <button
                            type="button"
                            class="app-steps__button"
                            [disabled]="i >= index()"
                            [attr.aria-current]="i === index() ? 'step' : null"
                            (click)="go(i)">
                            <span class="app-steps__mark" aria-hidden="true">
                                @if (i < index()) {
                                    <i class="pi pi-check"></i>
                                } @else {
                                    {{ i + 1 }}
                                }
                            </span>
                            <span class="app-steps__label">
                                {{ step.label }}
                                @if (i < index()) {
                                    <span class="sr-only">, done</span>
                                }
                            </span>
                        </button>
                    </li>
                }
            </ol>
            @if (hint(); as line) {
                <p class="app-steps__hint">{{ line }}</p>
            }
        </nav>
    `
})
export class AppSteps {
    readonly steps = input.required<Step[]>();
    readonly index = input.required<number>();
    readonly label = input('Progress');
    readonly indexChange = output<number>();

    readonly current = computed<Step | null>(() => this.steps()[this.index()] ?? null);

    /** The line under the heading. Its own computed so the template stays flat. */
    readonly hint = computed(() => this.current()?.hint ?? '');

    go(i: number): void {
        if (i >= this.index()) return;
        this.indexChange.emit(i);
    }
}
