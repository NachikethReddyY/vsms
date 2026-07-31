import { ArrowRightIcon, EyeIcon, EyeSlashIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getApiMessage, useAuth } from '../auth/authState';
import { Meteors, ThemeToggle } from './MagicEffects';

type LoginFields = { identifier: string; password: string };

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFields>();
  if (user) return <Navigate to="/events" replace />;

  const submit = async (values: LoginFields) => {
    setFormError('');
    try {
      await login(values.identifier, values.password);
      sessionStorage.setItem('vsms:celebrate', 'true');
      const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/events';
      navigate(destination, { replace: true });
    } catch (error) {
      setFormError(getApiMessage(error, 'Sign in failed. Check your credentials and try again.'));
    }
  };

  return (
    <main className="auth-page">
      <Meteors count={12} />
      <header className="auth-topbar"><div className="login-brand"><span aria-hidden="true">V</span><strong>VSMS</strong><small>Event operations</small></div><ThemeToggle /></header>
      <div className="auth-layout">
        <section className="auth-card-wrap" aria-label="Sign in">
          <form className="login-form auth-card" onSubmit={handleSubmit(submit)} noValidate>
            <div className="login-icon"><LockClosedIcon /></div>
            <h2>Welcome back</h2><p>Sign in to pick up today’s event operations.</p>
          {formError && <div className="alert error" role="alert">{formError}</div>}
          <label>Username or email<input type="text" autoComplete="username" placeholder="you@organisation.org" {...register('identifier', { required: 'Enter your username or email' })} aria-invalid={!!errors.identifier}/></label>
          {errors.identifier && <span className="field-error">{errors.identifier.message}</span>}
          <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" {...register('password', { required: 'Enter your password' })} aria-invalid={!!errors.password}/><button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeSlashIcon /> : <EyeIcon />}</button></span></label>
          {errors.password && <span className="field-error">{errors.password.message}</span>}
          <button className="primary wide interactive-cta" disabled={isSubmitting}><span>{isSubmitting ? 'Opening workspace…' : 'Enter workspace'}</span><ArrowRightIcon /></button>
          <p className="form-note">Need an account? <Link to="/signup">Create one</Link></p>
          </form>
        </section>
      </div>
    </main>
  );
}