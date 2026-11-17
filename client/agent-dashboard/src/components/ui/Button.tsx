import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, children, ...props }, ref) => {
    const baseStyle = 'inline-flex items-center justify-center gap-1.5 font-semibold rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-link/40 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap';
    
    const variants = {
      primary: 'bg-ink text-on-ink hover:bg-ink/85',
      secondary: 'bg-subtle text-ink hover:bg-ink/10',
      ghost: 'bg-transparent text-ink hover:bg-ink/[0.05]',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
      success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    };

    const sizes = {
      sm: 'h-8 px-3 text-[13px]',
      md: 'h-9 px-4 text-[14px]',
      lg: 'h-11 px-5 text-[15px]',
      icon: 'w-9 h-9',
    };

    return (
      <button
        ref={ref}
        className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4 mr-2 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
