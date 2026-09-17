/** Thin wrapper over SweetAlert2 (confirmations) + ngx-toastr (toasts). */
import { Injectable, inject } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import Swal from 'sweetalert2';

@Injectable({ providedIn: 'root' })
export class NotifyService {
    private toastr = inject(ToastrService);

    success(message: string, title = 'Done'): void {
        this.toastr.success(message, title);
    }

    error(message: string, title = 'Problem'): void {
        this.toastr.error(message, title);
    }

    info(message: string, title = 'Note'): void {
        this.toastr.info(message, title);
    }

    warning(message: string, title = 'Check this'): void {
        this.toastr.warning(message, title);
    }

    /** Returns true if the user confirmed. */
    async confirm(message: string, title = 'Are you sure?', confirmText = 'Yes'): Promise<boolean> {
        const res = await Swal.fire({
            title,
            text: message,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#e11d48',
            cancelButtonColor: '#71717a'
        });
        return res.isConfirmed;
    }

    async alert(message: string, title = 'Notice', icon: 'success' | 'error' | 'info' | 'warning' = 'info'): Promise<void> {
        await Swal.fire({ title, text: message, icon, confirmButtonColor: '#2563eb' });
    }

    /**
     * Ask for one short piece of text. Returns null if they backed out.
     *
     * For the edits too small to deserve a form of their own -- renaming a
     * section, saying why a purchase order is being closed short. A whole
     * drawer for one field is more ceremony than the change is worth.
     */
    async prompt(
        message: string,
        title = 'Enter a value',
        initial = '',
        confirmText = 'Save'
    ): Promise<string | null> {
        const res = await Swal.fire({
            title,
            text: message,
            input: 'text',
            inputValue: initial,
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#71717a'
        });
        return res.isConfirmed ? String(res.value ?? '') : null;
    }
}
