// api/webhook.js - Fixed for Vercel (ES Modules)

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
    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        refresh_token: ZOHO_CONFIG.refreshToken,
        client_id: ZOHO_CONFIG.clientId,
        client_secret: ZOHO_CONFIG.clientSecret,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Token request failed: ${data.error || 'Unknown error'}`);
    }

    const { access_token, expires_in } = data;
    
    // Cache the token
    accessTokenCache.token = access_token;
    accessTokenCache.expires = Date.now() + (expires_in * 1000) - 60000; // Subtract 1 minute for safety
    
    return access_token;
  } catch (error) {
    console.error('Error getting access token:', error.message);
    throw new Error('Failed to authenticate with Zoho');
  }
}

/**
 * Create lead in Zoho CRM
 */
async function createZohoLead(leadData) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await fetch(`${ZOHO_CONFIG.domain}/crm/v2/Leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: [leadData]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`CRM request failed: ${data.message || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    console.error('Error creating Zoho lead:', error.message);
    throw new Error('Failed to create lead in Zoho CRM');
  }
}

/**
 * Map Webflow form data to Zoho lead format
 */
function mapFormDataToZohoLead(formData, formType) {
  const nameParts = (formData.name || 'Unknown User').split(' ');
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || 'User';

  const baseData = {
    First_Name: firstName,
    Last_Name: lastName,
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
 * Main webhook handler - FIXED FOR VERCEL
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
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    // Parse form data
    const formData = parseFormData(req.body);
    console.log('Received form data:', formData);
    
    // Validate form data
    const validationErrors = validateFormData(formData);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Validation failed: ${validationErrors.join(', ')}`,
        timestamp: new Date().toISOString()
      });
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
      return res.status(200).json({
        success: true,
        message: 'Lead created successfully in Zoho CRM',
        leadId: zohoResponse.data[0].details.id,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to create lead in Zoho CRM');
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred',
      timestamp: new Date().toISOString()
    });
  }
}
