import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, icon, ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label className="text-[14px] font-medium text-ink">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-3 text-faint pointer-events-none">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`w-full h-10 text-[14px] rounded-lg border bg-surface border-line text-ink placeholder:text-faint focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/[0.06] transition-colors ${
              icon ? 'pl-10' : 'pl-3'
            } pr-3 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : ''} ${className}`}
            {...props}
          />
        </div>
        {error && (
          <span className="text-[13px] text-red-600 font-medium">{error}</span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
