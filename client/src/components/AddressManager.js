import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert, Card, Badge } from 'react-bootstrap';
import axios from 'axios';
import API_BASE_URL from '../config/api';

function AddressManager({ show, onHide, onAddressAdded }) {
  const [addresses, setAddresses] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    full_address: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'India',
    is_default: false
  });

  useEffect(() => {
    if (show) {
      fetchAddresses();
    }
  }, [show]);

  const fetchAddresses = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/api/addresses`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAddresses(response.data.data || []);
    } catch (error) {
      console.error('Error fetching addresses:', error);
      setError('Failed to load addresses');
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const token = localStorage.getItem('token');
      
      if (editingAddress) {
        // Update existing address
        await axios.put(`${API_BASE_URL}/api/addresses/${editingAddress.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSuccess('Address updated successfully!');
      } else {
        // Create new address
        await axios.post(`${API_BASE_URL}/api/addresses`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSuccess('Address added successfully!');
      }

      // Reset form and refresh addresses
      resetForm();
      fetchAddresses();
      if (onAddressAdded) onAddressAdded();
      
    } catch (error) {
      console.error('Error saving address:', error);
      setError(error.response?.data?.message || 'Failed to save address');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (address) => {
    setEditingAddress(address);
    setFormData({
      title: address.title,
      full_address: address.full_address,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country: address.country,
      is_default: address.is_default
    });
    setShowAddForm(true);
  };

  const handleDelete = async (addressId) => {
    if (!window.confirm('Are you sure you want to delete this address?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE_URL}/api/addresses/${addressId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess('Address deleted successfully!');
      fetchAddresses();
      if (onAddressAdded) onAddressAdded();
    } catch (error) {
      console.error('Error deleting address:', error);
      setError('Failed to delete address');
    }
  };

  const handleSetDefault = async (addressId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`${API_BASE_URL}/api/addresses/${addressId}/default`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess('Default address updated!');
      fetchAddresses();
      if (onAddressAdded) onAddressAdded();
    } catch (error) {
      console.error('Error setting default address:', error);
      setError('Failed to set default address');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      full_address: '',
      city: '',
      state: '',
      postal_code: '',
      country: 'India',
      is_default: false
    });
    setEditingAddress(null);
    setShowAddForm(false);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          {showAddForm ? (editingAddress ? 'Edit Address' : 'Add New Address') : 'Manage Addresses'}
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
        {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

        {!showAddForm ? (
          // Address List View
          <div>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6>Your Addresses ({addresses.length})</h6>
              <Button variant="primary" onClick={() => setShowAddForm(true)}>
                Add New Address
              </Button>
            </div>

            {addresses.length === 0 ? (
              <div className="text-center py-4">
                <div style={{ fontSize: '48px' }}>📍</div>
                <p className="text-muted">No addresses added yet</p>
                <Button variant="outline-primary" onClick={() => setShowAddForm(true)}>
                  Add Your First Address
                </Button>
              </div>
            ) : (
              addresses.map(address => (
                <Card key={address.id} className="mb-3">
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center mb-2">
                          <h6 className="mb-0 me-2">{address.title}</h6>
                          {address.is_default && (
                            <Badge bg="success" className="me-2">Default</Badge>
                          )}
                        </div>
                        <p className="mb-1">{address.full_address}</p>
                        <p className="mb-0 text-muted">
                          {address.city}, {address.state} - {address.postal_code}
                        </p>
                      </div>
                      <div className="d-flex flex-column gap-1">
                        {!address.is_default && (
                          <Button 
                            variant="outline-success" 
                            size="sm"
                            onClick={() => handleSetDefault(address.id)}
                          >
                            Set Default
                          </Button>
                        )}
                        <Button 
                          variant="outline-primary" 
                          size="sm"
                          onClick={() => handleEdit(address)}
                        >
                          Edit
                        </Button>
                        <Button 
                          variant="outline-danger" 
                          size="sm"
                          onClick={() => handleDelete(address.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              ))
            )}
          </div>
        ) : (
          // Add/Edit Form View
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Address Title *</Form.Label>
              <Form.Control
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g., Home, Office, etc."
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Full Address *</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                name="full_address"
                value={formData.full_address}
                onChange={handleInputChange}
                placeholder="Enter complete address with building, street, area"
                required
              />
            </Form.Group>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>City *</Form.Label>
                  <Form.Control
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    required
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>State *</Form.Label>
                  <Form.Control
                    type="text"
                    name="state"
                    value={formData.state}
                    onChange={handleInputChange}
                    required
                  />
                </Form.Group>
              </div>
            </div>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>Postal Code *</Form.Label>
                  <Form.Control
                    type="text"
                    name="postal_code"
                    value={formData.postal_code}
                    onChange={handleInputChange}
                    required
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>Country</Form.Label>
                  <Form.Control
                    type="text"
                    name="country"
                    value={formData.country}
                    onChange={handleInputChange}
                  />
                </Form.Group>
              </div>
            </div>

            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                name="is_default"
                checked={formData.is_default}
                onChange={handleInputChange}
                label="Set as default address"
              />
            </Form.Group>

            <div className="d-flex gap-2">
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Saving...' : (editingAddress ? 'Update Address' : 'Add Address')}
              </Button>
            </div>
          </Form>
        )}
      </Modal.Body>
    </Modal>
  );
}

export default AddressManager;
