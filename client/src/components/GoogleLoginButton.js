import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function GoogleLoginButton() {
  const navigate = useNavigate();

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      // Send the Google token to your backend
      const response = await axios.post('http://localhost:3001/api/auth/google', {
        token: credentialResponse.credential
      });

      // Store the JWT token
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      // Redirect to menu
      navigate('/menu');
    } catch (error) {
      console.error('Google login failed:', error);
      alert('Google login failed. Please try again.');
    }
  };

  const handleGoogleError = () => {
    console.error('Google login failed');
    alert('Google login failed. Please try again.');
  };

  return (
    <GoogleLogin
      onSuccess={handleGoogleSuccess}
      onError={handleGoogleError}
      useOneTap={false}
      theme="outline"
      size="large"
      text="continue_with"
      shape="rectangular"
      logo_alignment="left"
    />
  );
}

export default GoogleLoginButton;
