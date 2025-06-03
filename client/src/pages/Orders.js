import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Spinner, Alert, Badge } from 'react-bootstrap';
import axios from 'axios';

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in to view your orders.');
      setLoading(false);
      return;
    }
    try {
      const response = await axios.get('http://localhost:3001/api/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data.data);
    } catch (err) {
      setError('Failed to fetch orders.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p>Loading your orders...</p>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Alert variant="danger">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <h2 className="mb-4">My Orders</h2>
      <Row>
        {orders.length === 0 ? (
          <Col className="text-center">
            <p className="text-muted">You have not placed any orders yet.</p>
          </Col>
        ) : (
          orders.map(order => (
            <Col md={6} lg={4} key={order.id} className="mb-4">
              <Card>
                <Card.Body>
                  <Card.Title>
                    Order #{order.id}{' '}
                    <Badge bg={order.status === 'placed' ? 'info' : 'success'}>
                      {order.status}
                    </Badge>
                  </Card.Title>
                  <Card.Text>
                    <strong>Date:</strong> {new Date(order.created_at).toLocaleString()}
                  </Card.Text>
                  <Card.Text>
                    <strong>Items:</strong>
                    <ul>
                      {order.items.map((item, idx) => (
                        <li key={idx}>
                          {item.name} x {item.quantity} (₹{item.price})
                        </li>
                      ))}
                    </ul>
                  </Card.Text>
                  <Card.Text>
                    <strong>Total:</strong> ₹{order.total}
                  </Card.Text>
                </Card.Body>
              </Card>
            </Col>
          ))
        )}
      </Row>
    </Container>
  );
}

export default Orders;
