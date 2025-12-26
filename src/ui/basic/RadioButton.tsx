import "./RadioButton.css"

export interface RadioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {

    selected?: boolean;

    children: React.ReactNode;
    className?: string;
}

export const RadioButton: React.FC<RadioButtonProps> = ({ children, className, ...props }) => {
    const classes = ['radio-button'];
    classes.push(props.selected ? 'radio-button--selected' : 'radio-button--unselected');
    if (className) {
        classes.push(className);
    }
    return (
        <button
            className={classes.join(' ')}
            {...props}
        >
            {children}
        </button>
    );
};