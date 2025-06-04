import React, { useEffect, useState } from 'react';
import axios from 'axios';
import API_BASE_URL from '../config/api';

function Subscriptions() {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/subscriptions/plans`)
      .then(res => setPlans(res.data.data))
      .catch(err => setError('Failed to load plans'));
  }, []);

  if (error) return <div>{error}</div>;

  return (
    <div>
      <h2>Subscription Plans</h2>
      <ul>
        {plans.map(plan => (
          <li key={plan.id}>
            <b>{plan.name}</b>: {plan.description} — ₹{plan.price}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Subscriptions;
