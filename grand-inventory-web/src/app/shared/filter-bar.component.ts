/**
 * The row of filter chips above a list.
 *
 * These were PrimeNG buttons with `[outlined]="filter() !== 'x'"`, which looks
 * right and does not work: the `pButton` directive reads `outlined` when it sets
 * the button up and does not re-apply the class when the binding changes. The
 * filter switched, the list reloaded, and the highlight stayed on whatever had
 * been selected when the screen first rendered - so every filter row in the app
 * looked stuck on its first option.
 *
 * Plain buttons with a class this component controls, so the selected state is
 * simply a function of the current value.
 */
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FilterOption<T> {
    value: T;
    label: string;
    /** PrimeIcons class, e.g. 'pi pi-exclamation-triangle'. */
    icon?: string;
}

@Component({
    selector: 'app-filter-bar',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="app-filters" role="group" [attr.aria-label]="label()">
            @for (option of options(); track option.value) {
                <button
                    type="button"
                    class="app-filter"
                    [class.app-filter--on]="option.value === value()"
                    [attr.aria-pressed]="option.value === value()"
                    (click)="pick(option.value)">
                    @if (option.icon) {
                        <i [class]="option.icon" aria-hidden="true"></i>
                    }
                    <span>{{ option.label }}</span>
                </button>
            }
            <ng-content />
        </div>
    `
})
export class AppFilterBar<T> {
    readonly options = input.required<FilterOption<T>[]>();
    readonly value = input.required<T>();
    readonly label = input('Filter');
    readonly valueChange = output<T>();

    pick(next: T): void {
        if (next === this.value()) return;
        this.valueChange.emit(next);
    }
}
