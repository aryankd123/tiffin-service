import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Badge, Spinner, Alert, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import API_BASE_URL from '../config/api';

function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchOrders();
  }, [user, navigate]);

  const fetchOrders = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/api/orders/my-orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data.data || response.data);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <Container className="py-5">
        <Alert variant="warning">
          Please log in to view your orders.
          <Button variant="outline-warning" className="ms-3" onClick={() => navigate('/login')}>
            Login
          </Button>
        </Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
        <p className="mt-3">Loading your orders...</p>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <Row className="mb-4">
        <Col>
          <h1>My Orders</h1>
          <p className="text-muted">View and track your order history</p>
        </Col>
      </Row>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {orders.length === 0 ? (
        <Card className="text-center p-5">
          <Card.Body>
            <div style={{ fontSize: '80px', marginBottom: '20px' }}>🍽️</div>
            <h3>No Orders Yet</h3>
            <p className="text-muted mb-4">
              You haven't placed any orders yet. Start exploring our delicious menu!
            </p>
            <Button variant="primary" size="lg" onClick={() => navigate('/menu')}>
              Browse Menu
            </Button>
          </Card.Body>
        </Card>
      ) : (
        <Card>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Order History ({orders.length} orders)</h5>
            <Button variant="outline-primary" onClick={() => navigate('/menu')}>
              Order Again
            </Button>
          </Card.Header>
          <Card.Body className="p-0">
            <Table responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>Order ID</th>
                  <th>Items</th>
                  <th>Total Amount</th>
                  <th>Status</th>
                  <th>Order Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id}>
                    <td>
                      <strong>#{order.id}</strong>
                    </td>
                    <td>
                      {order.items ? (
                        <div>
                          {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          <br />
                          <small className="text-muted">
                            {order.items.slice(0, 2).map(item => item.name).join(', ')}
                            {order.items.length > 2 && ` +${order.items.length - 2} more`}
                          </small>
                        </div>
                      ) : (
                        <span className="text-muted">Items not available</span>
                      )}
                    </td>
                    <td>
                      <strong>₹{order.total_amount}</strong>
                    </td>
                    <td>
                      <Badge 
                        bg={
                          order.status === 'delivered' ? 'success' :
                          order.status === 'preparing' ? 'warning' :
                          order.status === 'cancelled' ? 'danger' : 'primary'
                        }
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td>
                      {new Date(order.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td>
                      <Button variant="outline-primary" size="sm">
                        View Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}

export default Orders;
