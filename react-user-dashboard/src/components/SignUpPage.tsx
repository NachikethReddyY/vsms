import React from 'react';
import axios from 'axios';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { getApiMessage, useAuth } from '../auth/authState';
import apiClient from '../utils/apiClient';
import { Meteors, ThemeToggle } from './MagicEffects';

interface SignUpFormInputs {
  email: string;
  password: string;
  confirmPassword: string;
}

const SignUpPage: React.FC = () => {
  const { login } = useAuth();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignUpFormInputs>();
  const navigate = useNavigate();
  const [formError, setFormError] = React.useState('');

  const onSubmit = async (data: SignUpFormInputs) => {
    setFormError('');
    if (data.password !== data.confirmPassword) {
      setFormError('The passwords do not match.');
      return;
    }

    try {
      await apiClient.post('/auth/signup', { email: data.email, password: data.password });
      await login(data.email, data.password);
      sessionStorage.setItem('vsms:celebrate', 'true');
      navigate('/events', { replace: true });
    } catch (error) {
      console.error('Sign up failed:', error);
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setFormError('An account already uses those details. Try signing in or contact an administrator.');
      } else if (axios.isAxiosError(error) && error.response?.status === 404) {
        setFormError('Registration is currently closed. Ask an administrator to enable staff sign-up.');
      } else {
        setFormError(getApiMessage(error, 'We could not create your account. Please try again.'));
      }
    }
  };

  return (
    <main className="auth-page auth-page-compact">
      <Meteors count={12} />
      <header className="auth-topbar"><div className="login-brand"><span aria-hidden="true">V</span><strong>VSMS</strong><small>Event operations</small></div><ThemeToggle /></header>
      <section className="auth-card-wrap">
      <form onSubmit={handleSubmit(onSubmit)} className="auth-card signup-form" noValidate>
        <h1>Create your staff account</h1>
        <p>Use your work email. Registration must already be enabled by a VSMS administrator.</p>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <div>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@organisation.org"
            {...register('email', {
              required: 'Email is required',
              pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
            })}
          />
          {errors.email && <span className="field-error">{errors.email.message}</span>}
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 12, message: 'Use at least 12 characters' },
            })}
          />
          {errors.password && <span className="field-error">{errors.password.message}</span>}
        </div>
        <div>
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword', { required: 'Please confirm your password' })}
          />
          {errors.confirmPassword && <span className="field-error">{errors.confirmPassword.message}</span>}
        </div>
        <button type="submit" className="primary wide interactive-cta" disabled={isSubmitting}><span>{isSubmitting ? 'Creating account...' : 'Create account'}</span><span aria-hidden="true">→</span></button>
        <p className="form-note">Already provisioned? <Link to="/login">Return to sign in</Link></p>
      </form>
      </section>
    </main>
  );
};

export default SignUpPage;
