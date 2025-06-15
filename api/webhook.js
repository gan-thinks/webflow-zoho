// api/webhook.js - Vercel Function to handle Webflow form submissions
const axios = require('axios');

// Zoho API Configuration
const ZOHO_CONFIG = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  domain: process.env.ZOHO_DOMAIN || 'https://www.zohoapis.com'
};

// Cache for access token
let accessTokenCache = {
  token: null,
  expires: 0
};

/**
 * Get fresh access token from Zoho
 */
async function getAccessToken() {
  // Return cached token if still valid
  if (accessTokenCache.token && Date.now() < accessTokenCache.expires) {
    return accessTokenCache.token;
  }

  try {
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: ZOHO_CONFIG.refreshToken,
        client_id: ZOHO_CONFIG.clientId,
        client_secret: ZOHO_CONFIG.clientSecret,
        grant_type: 'refresh_token'
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, expires_in } = response.data;
    
    // Cache the token
    accessTokenCache.token = access_token;
    accessTokenCache.expires = Date.now() + (expires_in * 1000) - 60000; // Subtract 1 minute for safety
    
    return access_token;
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Zoho');
  }
}

/**
 * Create lead in Zoho CRM
 */
async function createZohoLead(leadData) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `${ZOHO_CONFIG.domain}/crm/v2/Leads`,
      {
        data: [leadData]
      },
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error creating Zoho lead:', error.response?.data || error.message);
    throw new Error('Failed to create lead in Zoho CRM');
  }
}

/**
 * Map Webflow form data to Zoho lead format
 */
function mapFormDataToZohoLead(formData, formType) {
  const baseData = {
    First_Name: formData.name?.split(' ')[0] || 'Unknown',
    Last_Name: formData.name?.split(' ').slice(1).join(' ') || 'User',
    Email: formData.email,
    Phone: formData.phone || null,
    Company: formData.company || null,
    Lead_Source: 'Website',
    Lead_Status: 'Not Contacted',
    Description: formData.message || null
  };

  // Customize based on form type
  switch (formType) {
    case 'contact':
      return {
        ...baseData,
        Lead_Source: 'Website - Contact Form'
      };
    case 'newsletter':
      return {
        ...baseData,
        Lead_Source: 'Website - Newsletter',
        Lead_Status: 'Qualified'
      };
    default:
      return baseData;
  }
}

/**
 * Parse form data from request
 */
function parseFormData(body) {
  // Handle URL encoded form data
  if (typeof body === 'string') {
    const params = new URLSearchParams(body);
    const formData = {};
    for (const [key, value] of params) {
      formData[key] = value;
    }
    return formData;
  }
  
  // Handle JSON data
  return body;
}

/**
 * Send success response with CORS headers
 */
function sendSuccessResponse(res, message = 'Form submitted successfully') {
  return res.status(200).json({
    success: true,
    message: message,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send error response with CORS headers
 */
function sendErrorResponse(res, error, statusCode = 500) {
  console.error('Error:', error);
  return res.status(statusCode).json({
    success: false,
    error: error.message || 'An error occurred',
    timestamp: new Date().toISOString()
  });
}

/**
 * Add CORS headers to response
 */
function addCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Validate required form fields
 */
function validateFormData(formData) {
  const errors = [];
  
  if (!formData.name || formData.name.trim().length === 0) {
    errors.push('Name is required');
  }
  
  if (!formData.email || formData.email.trim().length === 0) {
    errors.push('Email is required');
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (formData.email && !emailRegex.test(formData.email)) {
    errors.push('Invalid email format');
  }
  
  return errors;
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  // Add CORS headers to all responses
  addCORSHeaders(res);
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only accept POST requests
  if (req.method !== 'POST') {
    return sendErrorResponse(res, new Error('Method not allowed'), 405);
  }
  
  try {
    // Parse form data
    const formData = parseFormData(req.body);
    console.log('Received form data:', formData);
    
    // Validate form data
    const validationErrors = validateFormData(formData);
    if (validationErrors.length > 0) {
      return sendErrorResponse(res, new Error(`Validation failed: ${validationErrors.join(', ')}`), 400);
    }
    
    // Determine form type
    const formType = formData.form_type || 'general';
    
    // Map form data to Zoho lead format
    const zohoLeadData = mapFormDataToZohoLead(formData, formType);
    console.log('Mapped Zoho lead data:', zohoLeadData);
    
    // Create lead in Zoho CRM
    const zohoResponse = await createZohoLead(zohoLeadData);
    console.log('Zoho response:', zohoResponse);
    
    // Check if lead was created successfully
    if (zohoResponse.data && zohoResponse.data[0] && zohoResponse.data[0].status === 'success') {
      return sendSuccessResponse(res, 'Lead created successfully in Zoho CRM');
    } else {
      throw new Error('Failed to create lead in Zoho CRM');
    }
    
  } catch (error) {
    return sendErrorResponse(res, error);
  }
}
