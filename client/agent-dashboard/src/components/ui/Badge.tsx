import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'primary', className = '' }) => {
  const styles = {
    primary: 'bg-ink/[0.07] text-ink',
    secondary: 'bg-subtle text-muted',
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    danger: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  };

  return (
    <span className={`inline-flex items-center h-5 px-2 rounded-full text-[12px] font-medium ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
};

export default Badge;
