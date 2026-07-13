import React from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

interface LoginFormInputs {
  email: string;
  password: string;
}

const LoginPage: React.FC = () => {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormInputs>();
  const navigate = useNavigate();

  const onSubmit = async (data: LoginFormInputs) => {
    try {
      const response = await apiClient.post('/auth/login', data);
      interface LoginResponse {
        accessToken: string;
        refreshToken: string;
      }
      const { accessToken, refreshToken } = response.data as LoginResponse;
      localStorage.setItem('authToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      navigate('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
      alert('Invalid email or password');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-md p-8 bg-white rounded shadow">
        <h2 className="mb-6 text-2xl font-bold text-center">Login</h2>
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
        <div className="mb-6">
          <label htmlFor="password" className="block mb-2 text-sm font-medium text-gray-700">Password</label>
          <input
            id="password"
            type="password"
            {...register('password', { required: 'Password is required' })}
            className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.password && <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>}
        </div>
        <button
          type="submit"
          className="w-full px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Login
        </button>
        <div className="mt-4 text-center">
          <a href="/signup" className="text-sm text-blue-500 hover:underline">Sign Up</a> |{' '}
          <a href="/forgot-password" className="text-sm text-blue-500 hover:underline">Forgot Password?</a>
        </div>
      </form>
    </div>
  );
};

export default LoginPage;
