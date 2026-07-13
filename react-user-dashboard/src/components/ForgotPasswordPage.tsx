import React from 'react';
import { useForm } from 'react-hook-form';
import apiClient from '../utils/apiClient';

interface ForgotPasswordFormInputs {
  email: string;
}

const ForgotPasswordPage: React.FC = () => {
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordFormInputs>();

  const onSubmit = async (data: ForgotPasswordFormInputs) => {
    try {
      await apiClient.post('/auth/forgot-password', { email: data.email });
      alert('If this email is registered, you will receive a password reset link.');
    } catch (error) {
      console.error('Forgot password request failed:', error);
      alert('Failed to process the request. Please try again.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-md p-8 bg-white rounded shadow">
        <h2 className="mb-6 text-2xl font-bold text-center">Forgot Password</h2>
        <div className="mb-4">
          <label htmlFor="email" className="block mb-2 text-sm font-medium text-gray-700">Email</label>
          <input
            id="email"
            type="email"
            {...register('email', { required: 'Email is required' })}
            className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>}
        </div>
        <button
          type="submit"
          className="w-full px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Submit
        </button>
        <div className="mt-4 text-center">
          <a href="/login" className="text-sm text-blue-500 hover:underline">Back to Login</a>
        </div>
      </form>
    </div>
  );
};

export default ForgotPasswordPage;
