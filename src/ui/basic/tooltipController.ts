// enforces tooltip exclusivity and provides a way to close all tooltips at once

export type TooltipDismiss = () => void;

let gActiveTooltipDismiss: TooltipDismiss | null = null;

export function activateTooltip(dismiss: TooltipDismiss): void {
    if (gActiveTooltipDismiss === dismiss) return;

    const previousTooltipDismiss = gActiveTooltipDismiss;
    // Claim ownership first so the previous tooltip's cleanup cannot clear
    // the newly active tooltip.
    gActiveTooltipDismiss = dismiss;
    previousTooltipDismiss?.();
}

export function deactivateTooltip(dismiss: TooltipDismiss): void {
    if (gActiveTooltipDismiss === dismiss) {
        gActiveTooltipDismiss = null;
    }
}

export function closeAllTooltips(): void {
    const dismiss = gActiveTooltipDismiss;
    gActiveTooltipDismiss = null;
    dismiss?.();
}
