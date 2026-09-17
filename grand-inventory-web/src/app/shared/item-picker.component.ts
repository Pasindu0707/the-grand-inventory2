/**
 * Pick a product by typing part of its name.
 *
 * Every screen that names an item used to do it with a native `<select>`
 * holding the whole product master. That is fine at twelve products and
 * unusable at a hundred and it is a hundred on day one: the storekeeper
 * scrolled a list of a hundred lines on a tablet at the delivery door to find
 * "Chicken breast", and the list was in whatever order the API returned.
 *
 * So: one control, used everywhere an item is chosen, that searches as you
 * type. Matching is on name, code and category, because people reach for an
 * item by any of the three - "chicken", "MEA-001", or "meat" when they cannot
 * remember which chicken it was.
 *
 * `priority` is for the items this section actually uses. They sort first and
 * carry a label, which is what the Ask screen's "what you usually take" group
 * was doing before. Nothing is ever hidden by it - ordering solves what hiding
 * was trying to solve, and nothing goes missing.
 *
 * Keyboard: type to filter, arrows to move, Enter to take the highlighted one,
 * Escape to close. The list is a `listbox` with `aria-activedescendant` rather
 * than roving focus, so the input keeps the caret while the highlight moves.
 */
import {
    Component,
    ElementRef,
    computed,
    effect,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface PickableItem {
    id: number;
    code: string;
    name: string;
    stockUnit: string;
    categoryName?: string;
}

@Component({
    selector: 'app-item-picker',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
        <div class="app-picker" (focusout)="onFocusOut($event)">
            @if (label()) {
                <label
                    class="block text-sm font-medium mb-1"
                    [class.app-req]="required()"
                    [attr.for]="inputId">
                    {{ label() }}
                </label>
            }

            <div class="app-picker__field">
                <i class="pi pi-search app-picker__icon" aria-hidden="true"></i>
                <input
                    #input
                    [id]="inputId"
                    type="text"
                    role="combobox"
                    autocomplete="off"
                    class="app-picker__input"
                    [class.app-picker__input--chosen]="chosen() !== null && !open()"
                    [attr.aria-expanded]="open()"
                    [attr.aria-controls]="listId"
                    [attr.aria-activedescendant]="
                        open() && matches().length > 0 ? listId + '-' + highlight() : null
                    "
                    [placeholder]="placeholder()"
                    [disabled]="disabled()"
                    [ngModel]="text()"
                    (ngModelChange)="onType($event)"
                    (focus)="onFocus()"
                    (keydown)="onKey($event)" />

                @if (chosen(); as picked) {
                    <!-- The code sits inside the field rather than on a line of
                         its own beneath it. As a second line it made a chosen
                         row taller than an empty one, which pushed the quantity
                         box beside it out of alignment and made one question
                         look like two. The unit is not repeated here - the
                         quantity field next to it already asks in the unit. -->
                    @if (!open()) {
                        <span class="app-picker__inline-code" aria-hidden="true">
                            {{ picked.code }}
                        </span>
                    }
                    <button
                        type="button"
                        class="app-picker__clear"
                        aria-label="Clear the chosen product"
                        [disabled]="disabled()"
                        (click)="clear()">
                        <i class="pi pi-times" aria-hidden="true"></i>
                    </button>
                }
            </div>

            @if (open()) {
                <ul class="app-picker__list" role="listbox" [id]="listId">
                    @if (matches().length === 0) {
                        <li class="app-picker__empty">
                            @if (items().length === 0) {
                                No products yet. An admin adds them under Products.
                            } @else {
                                Nothing matches “{{ text() }}”.
                            }
                        </li>
                    }
                    @for (row of matches(); track row.item.id; let i = $index) {
                        @if (row.firstOther && i > 0) {
                            <li class="app-picker__group" role="presentation">
                                Everything else
                            </li>
                        } @else if (i === 0 && row.isPriority) {
                            <li class="app-picker__group" role="presentation">
                                {{ priorityLabel() }}
                            </li>
                        }
                        <li
                            role="option"
                            [id]="listId + '-' + i"
                            [attr.aria-selected]="i === highlight()"
                            class="app-picker__option"
                            [class.app-picker__option--on]="i === highlight()"
                            (mousedown)="$event.preventDefault(); pick(row.item)"
                            (mouseenter)="highlight.set(i)">
                            <span class="app-picker__name">{{ row.item.name }}</span>
                            <span class="app-picker__meta">
                                <span class="app-picker__code">{{ row.item.code }}</span>
                                <span>{{ row.item.stockUnit }}</span>
                            </span>
                        </li>
                    }
                </ul>
            }
        </div>
    `
})
export class AppItemPicker {
    readonly items = input.required<PickableItem[]>();
    readonly value = input<number | null>(null);
    readonly label = input<string>('');
    readonly placeholder = input('Type a product name or code');
    readonly required = input(false);
    readonly disabled = input(false);
    /** Item ids this section actually uses. They sort first, under a heading. */
    readonly priority = input<number[]>([]);
    readonly priorityLabel = input('What you usually take');
    readonly valueChange = output<number | null>();

    private static seq = 0;
    private readonly uid = ++AppItemPicker.seq;
    readonly inputId = `item-picker-${this.uid}`;
    readonly listId = `item-picker-list-${this.uid}`;

    private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');

    readonly text = signal('');
    readonly open = signal(false);
    readonly highlight = signal(0);

    readonly chosen = computed(
        () => this.items().find((i) => i.id === this.value()) ?? null
    );

    constructor() {
        // The caller owns the value; the text box follows it. Without this a
        // line whose item was set from outside -- a purchase order filling in
        // a delivery, a suggestion filling in a return -- shows an empty box
        // over a chosen item.
        effect(() => {
            const picked = this.chosen();
            if (!this.open()) this.text.set(picked ? picked.name : '');
        });
    }

    /**
     * What to show, in the order to show it.
     *
     * An empty box lists everything rather than nothing: opening the picker is
     * how you browse when you do not know the name. `firstOther` marks where
     * the section's own items stop and the rest of the master begins.
     */
    readonly matches = computed<
        { item: PickableItem; isPriority: boolean; firstOther: boolean }[]
    >(() => {
        const needle = this.text().trim().toLowerCase();
        const chosen = this.chosen();
        // A box still showing the chosen item's name is not a search for it.
        const searching = needle.length > 0 && needle !== chosen?.name.toLowerCase();

        const hit = (i: PickableItem) =>
            !searching ||
            i.name.toLowerCase().includes(needle) ||
            i.code.toLowerCase().includes(needle) ||
            (i.categoryName ?? '').toLowerCase().includes(needle);

        const priority = new Set(this.priority());
        const found = this.items().filter(hit);
        const mine = found.filter((i) => priority.has(i.id));
        const rest = found.filter((i) => !priority.has(i.id));

        const ordered = [...mine, ...rest].slice(0, 60);
        return ordered.map((item, idx) => ({
            item,
            isPriority: priority.has(item.id),
            firstOther: mine.length > 0 && idx === mine.length
        }));
    });

    onFocus(): void {
        if (this.disabled()) return;
        this.open.set(true);
        this.highlight.set(0);
        this.inputEl()?.nativeElement.select();
    }

    onType(next: string): void {
        this.text.set(next);
        this.open.set(true);
        this.highlight.set(0);
        // Typing over a chosen item un-chooses it. Leaving the old id set
        // behind new text is how a line ends up claiming to be one product and
        // reading as another.
        if (this.value() !== null && next.trim() !== this.chosen()?.name) {
            this.valueChange.emit(null);
        }
    }

    onKey(event: KeyboardEvent): void {
        const rows = this.matches();
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.open.set(true);
                this.highlight.update((i) => Math.min(i + 1, rows.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.highlight.update((i) => Math.max(i - 1, 0));
                break;
            case 'Enter': {
                const row = rows[this.highlight()];
                if (this.open() && row) {
                    event.preventDefault();
                    this.pick(row.item);
                }
                break;
            }
            case 'Escape':
                if (this.open()) {
                    event.preventDefault();
                    this.close();
                }
                break;
        }
    }

    pick(item: PickableItem): void {
        this.valueChange.emit(item.id);
        this.text.set(item.name);
        this.close();
    }

    clear(): void {
        this.valueChange.emit(null);
        this.text.set('');
        this.open.set(true);
        this.inputEl()?.nativeElement.focus();
    }

    /**
     * Closing on blur, but only when focus has actually left the control --
     * the clear button lives inside it, and closing before its click lands
     * would swallow the click.
     */
    onFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget as Node | null;
        const host = (event.currentTarget as HTMLElement) ?? null;
        if (next && host?.contains(next)) return;
        this.close();
    }

    private close(): void {
        this.open.set(false);
        this.text.set(this.chosen()?.name ?? '');
    }
}
