document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const chatMessages = document.querySelector('.chat-messages');
  const sendButton = document.getElementById('send-button');
  const messageInput = document.getElementById('message-input');
  
  // Cache username and password inputs to avoid repetitive DOM queries
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  
  // Signup form submission
  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();
  
      if (!username || !password) {
        alert('Please enter a username and password.');
        return;
      }
  
      if (username.length < 4 || password.length < 6) {
        alert('Username must be at least 4 characters and password at least 6 characters.');
        return;
      }
  
      try {
        const response = await fetch('/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });
  
        if (response.ok) {
          alert('Sign up successful! Please login.');
          window.location.href = 'login.html';
        } else if (response.status === 409) {
          alert('Username already exists');
        } else {
          alert('An error occurred during sign up');
        }
      } catch (error) {
        console.error('Error signing up:', error);
        alert('An error occurred during sign up');
      }
    });
  }
  
  // Login form submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();
  
      if (!username || !password) {
        alert('Please enter a username and password.');
        return;
      }
  
      try {
        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password })
        });
  
        if (response.ok) {
          // Save username to localStorage
          localStorage.setItem('username', username);
          window.location.href = 'chat.html';
        } else if (response.status === 401) {
          alert('Invalid username or password');
        } else {
          alert('An error occurred during login');
        }
      } catch (error) {
        console.error('Error logging in:', error);
        alert('An error occurred during login');
      }
    });
  }
  
  // Chat functionality
  if (chatMessages && sendButton && messageInput) {
    const ws = new WebSocket('ws://localhost:6969');
  
    ws.onopen = () => {
      console.log('WebSocket connection opened');
    };
  
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.deleted) {
        // Handle deleted message case (e.g., remove from UI)
        const messageElements = document.querySelectorAll(`[data-id='${message.messageId}']`);
        messageElements.forEach((el) => {
          el.remove();
        });
      } else {
        const messageElement = document.createElement('div');
        messageElement.textContent = `${message.username}: ${message.content}`;
        messageElement.setAttribute('data-id', message.messageId); // Add message ID for easy deletion later
        chatMessages.appendChild(messageElement);
      }
    };
  
    sendButton.addEventListener('click', () => {
      const message = messageInput.value.trim();
      const username = localStorage.getItem('username');
  
      if (message && username) {
        const messageData = {
          username,
          content: message
        };
        ws.send(JSON.stringify(messageData));
        messageInput.value = ''; // Clear input after sending
      }
    });
  }
});
