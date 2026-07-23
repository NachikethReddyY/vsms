import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRightOnRectangleIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import apiClient from '../utils/apiClient';
import { getSafeRedirectUrl } from '../utils/safeNavigation';

interface LoginFormInputs {
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

const LoginPage: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormInputs>();

  const onSubmit = async (data: LoginFormInputs) => {
    setErrorMessage(null);
    try {
      const response = await apiClient.post<LoginResponse>('/auth/login', data);
      const { accessToken, refreshToken } = response.data;

      localStorage.setItem('authToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      const rawReturnUrl = searchParams.get('returnUrl') || searchParams.get('redirect');
      const safeDestination = getSafeRedirectUrl(rawReturnUrl, '/dashboard');

      if (safeDestination.startsWith('/')) {
        navigate(safeDestination);
      } else {
        window.location.href = safeDestination;
      }
    } catch (error: any) {
      console.error('Login failed:', error);
      const serverMessage = error.response?.data?.message || 'Invalid email or password. Please try again.';
      setErrorMessage(serverMessage);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#111416] px-5 py-5 text-zinc-100 sm:px-8">
      {/* Background gradients */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_23%_20%,rgba(95,76,83,0.22),transparent_34%),radial-gradient(circle_at_73%_21%,rgba(64,67,94,0.20),transparent_32%),radial-gradient(circle_at_50%_76%,rgba(124,59,50,0.12),transparent_35%),linear-gradient(120deg,rgba(20,28,27,0.95),rgba(28,25,27,0.98)_52%,rgba(14,24,25,0.95))]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-55 [background-image:linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.014)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:radial-gradient(circle_at_center,black_0%,transparent_72%)]"
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between text-sm text-zinc-400">
        <Link to="/login" className="text-lg font-bold tracking-tight text-zinc-300 transition hover:text-white">
          optix<span className="text-zinc-500">+</span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          <span className="hidden font-medium text-zinc-500 sm:inline">Optix workspace</span>
          <Link
            to="/signup"
            className="rounded-full bg-white/10 px-4 py-2 font-semibold text-zinc-200 transition hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Sign Up
          </Link>
        </nav>
      </header>

      {/* Login Card Section */}
      <section className="relative z-10 flex min-h-[calc(100dvh-88px)] items-center justify-center py-12">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="w-full max-w-[390px] rounded-[22px] border border-white/10 bg-[#242225]/80 p-5 text-left shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-6"
        >
          <div className="mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-white/10 text-zinc-200 ring-1 ring-white/10">
            <ArrowRightOnRectangleIcon className="h-8 w-8" aria-hidden="true" />
          </div>

          <div className="mb-6">
            <h1 className="text-[1.45rem] font-bold leading-tight tracking-normal text-white">Welcome to Optix</h1>
            <p className="mt-2 text-[0.98rem] font-medium text-zinc-400">Sign in with your email and password.</p>
          </div>

          {/* Inline Error Banner */}
          {errorMessage && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-semibold text-zinc-100">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...register('email', {
                  required: 'Enter your email address',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Use a valid email address',
                  },
                })}
                className="h-11 w-full rounded-lg border border-white/30 bg-black/25 px-4 text-[0.95rem] font-medium text-white caret-white outline-none transition placeholder:text-zinc-600 hover:border-white/45 focus:border-white focus:ring-2 focus:ring-white/20"
              />
              {errors.email && <p className="mt-2 text-sm font-medium text-red-300">{errors.email.message}</p>}
            </div>

            {/* Password Input */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="password" className="block text-sm font-semibold text-zinc-100">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-sm font-semibold text-zinc-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  Forgot?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  {...register('password', { required: 'Enter your password' })}
                  className="h-11 w-full rounded-lg border border-white/30 bg-black/25 px-4 pr-12 text-[0.95rem] font-medium text-white caret-white outline-none transition placeholder:text-zinc-600 hover:border-white/45 focus:border-white focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <EyeIcon className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && <p className="mt-2 text-sm font-medium text-red-300">{errors.password.message}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-50 px-4 text-[0.95rem] font-bold text-zinc-950 shadow-sm transition hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            <LockClosedIcon className="h-5 w-5" aria-hidden="true" />
            {isSubmitting ? 'Signing In...' : 'Sign In'}
          </button>

          <div className="my-5 h-px bg-white/10" />

          <div className="grid gap-2">
            <Link
              to="/signup"
              className="flex h-10 items-center justify-center rounded-lg bg-white/10 px-4 text-sm font-bold text-zinc-300 transition hover:bg-white/15 hover:text-white active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              Create New Account
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
};

export default LoginPage;