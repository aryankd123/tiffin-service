const Address = require('../models/Address');

const createAddress = async (req, res) => {
  try {
    console.log('=== CREATE ADDRESS DEBUG ===');
    console.log('User from token:', req.user);
    console.log('Request body:', req.body);
    
    const userId = req.user.userId;
    console.log('Extracted userId:', userId);
    
    if (!userId) {
      console.error('No userId found in token');
      return res.status(400).json({
        success: false,
        message: 'User ID not found in token'
      });
    }
    
    const addressData = { ...req.body, user_id: userId };
    console.log('Address data to save:', addressData);
    
    const address = await Address.create(addressData);
    console.log('Address created successfully:', address);
    
    res.status(201).json({
      success: true,
      message: 'Address created successfully',
      data: address
    });
  } catch (error) {
    console.error('Error in createAddress:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create address',
      error: error.message
    });
  }
};

const getUserAddresses = async (req, res) => {
  try {
    console.log('=== GET USER ADDRESSES DEBUG ===');
    console.log('User from token:', req.user);
    
    const userId = req.user.userId;
    console.log('Fetching addresses for userId:', userId);
    
    const addresses = await Address.getByUserId(userId);
    console.log('Found addresses:', addresses);
    
    res.json({
      success: true,
      data: addresses
    });
  } catch (error) {
    console.error('Error in getUserAddresses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch addresses'
    });
  }
};

const updateAddress = async (req, res) => {
  try {
    console.log('=== UPDATE ADDRESS DEBUG ===');
    console.log('User from token:', req.user);
    console.log('Address ID:', req.params.id);
    console.log('Update data:', req.body);
    
    const userId = req.user.userId;
    const addressId = req.params.id;
    
    const address = await Address.update(addressId, userId, req.body);
    console.log('Updated address:', address);
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Address updated successfully',
      data: address
    });
  } catch (error) {
    console.error('Error in updateAddress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update address'
    });
  }
};

const deleteAddress = async (req, res) => {
  try {
    console.log('=== DELETE ADDRESS DEBUG ===');
    console.log('User from token:', req.user);
    console.log('Address ID to delete:', req.params.id);
    
    const userId = req.user.userId;
    const addressId = req.params.id;
    
    const address = await Address.delete(addressId, userId);
    console.log('Deleted address:', address);
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteAddress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete address'
    });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    console.log('=== SET DEFAULT ADDRESS DEBUG ===');
    console.log('User from token:', req.user);
    console.log('Address ID to set as default:', req.params.id);
    
    const userId = req.user.userId;
    const addressId = req.params.id;
    
    const address = await Address.setDefault(addressId, userId);
    console.log('Set as default address:', address);
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Default address updated successfully',
      data: address
    });
  } catch (error) {
    console.error('Error in setDefaultAddress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set default address'
    });
  }
};

module.exports = {
  createAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress
};
