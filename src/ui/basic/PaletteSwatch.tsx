
type PaletteSwatchProps = {
    color: string;
    contrast?: string;
    children?: React.ReactNode;
};

export const PaletteSwatch: React.FC<PaletteSwatchProps> = ({ color, contrast, children }) => {
    const onDragStart = (ev: React.DragEvent<HTMLDivElement>) => {
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData('application/x-somatic-color', color);
        ev.dataTransfer.setData('text/plain', color);
    };

    return (
        <div
            //type="button"
            className="theme-panel__swatch"
            draggable
            onDragStart={onDragStart}
            style={{ background: color, color: contrast || '#000' }}
            title={`Drag to apply ${color}`}
        >
            {children}
        </div>
    );
};
