import React, { useState } from 'react';
import axios from 'axios';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import './SignUpPage.css';

interface SignUpFormInputs {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const SignUpPage: React.FC = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormInputs>();

  const navigate = useNavigate();
  const password = watch('password');

  const onSubmit = async (data: SignUpFormInputs) => {
    setErrorMessage(null);

    try {
      await apiClient.post('/auth/signup', {
        fullName: data.fullName,
        email: data.email,
        password: data.password,
      });

      alert('Sign up successful! Please log in.');
      navigate('/login');
    } catch (error: unknown) {
      const serverMessage = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message || 'Failed to create account. Please try again.'
        : 'Failed to create account. Please try again.';
      setErrorMessage(serverMessage);
    }
  };

  return (
    <main className="vsms-auth-container">
      <div className="vsms-auth-card">
        {/* Header */}
        <div className="mb-6">
          <h1 className="vsms-auth-title">Create Staff Account</h1>
          <p className="vsms-auth-subtitle">
            Register your credentials for VSMS screening access.
          </p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
         <div className="vsms-alert-banner" role="alert">
      {errorMessage}
  </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {/* Full Name */}
          <div className="vsms-field-group">
            <label htmlFor="fullName" className="vsms-label">
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              placeholder="Dr. Alex Rivera"
              {...register('fullName', {
                required: 'Full name is required',
              })}
              className="vsms-input"
            />
            {errors.fullName && (
              <p className="vsms-error-text">{errors.fullName.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="vsms-field-group">
            <label htmlFor="email" className="vsms-label">
              Staff Email Address
            </label>
            <input
              id="email"
              type="email"
              placeholder="staff@vsms.org"
              {...register('email', {
                required: 'Email is required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Use a valid email format',
                },
              })}
              className="vsms-input"
            />
            {errors.email && (
              <p className="vsms-error-text">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div className="vsms-field-group">
            <label htmlFor="password" className="vsms-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              {...register('password', {
                required: 'Password is required',
                minLength: {
                  value: 8,
                  message: 'Password must be at least 8 characters',
                },
              })}
              className="vsms-input"
            />
            {errors.password && (
              <p className="vsms-error-text">{errors.password.message}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="vsms-field-group">
            <label htmlFor="confirmPassword" className="vsms-label">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              {...register('confirmPassword', {
                required: 'Please confirm your password',
                validate: (value) =>
                  value === password || 'Passwords do not match',
              })}
              className="vsms-input"
            />
            {errors.confirmPassword && (
              <p className="vsms-error-text">{errors.confirmPassword.message}</p>
            )}
          </div>

          {/* Submit CTA */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="vsms-btn-primary"
          >
            {isSubmitting ? 'Creating Account...' : 'Register Account'}
          </button>
        </form>

        {/* Footer */}
        <div className="vsms-footer-link">
          Already registered?{' '}
          <Link to="/login" className="vsms-link">
            Log in here
          </Link>
        </div>
      </div>
    </main>
  );
};

export default SignUpPage;
