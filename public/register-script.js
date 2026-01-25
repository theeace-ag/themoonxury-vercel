// MOONXURY - Register Page (Manual Payment Flow)
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initForm();
    initModals();
});

// Particle Animation
function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const particleCount = 30;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDelay = `${Math.random() * 15}s`;
        particle.style.animationDuration = `${15 + Math.random() * 10}s`;
        container.appendChild(particle);
    }
}

// Global state
let currentRegistration = null;

// Form Handling
function initForm() {
    const form = document.getElementById('registrationForm');
    const loadingOverlay = document.getElementById('loadingOverlay');

    if (!form) return;

    // Phone input validation
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
        });
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value.trim();
        const peopleCount = document.getElementById('peopleCount').value;
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();

        if (!name || !peopleCount || !email || !phone) {
            alert('Please fill in all fields');
            return;
        }

        if (phone.length !== 10) {
            alert('Please enter a valid 10-digit phone number');
            return;
        }

        // Store for later
        currentRegistration = { name, peopleCount, email, phone };

        // Show payment modal
        document.getElementById('paymentModal').classList.add('active');
    });
}

// Modal handling
function initModals() {
    const paymentModal = document.getElementById('paymentModal');
    const successModal = document.getElementById('successModal');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Cancel payment
    const cancelBtn = document.getElementById('cancelPaymentBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            paymentModal.classList.remove('active');
        });
    }

    // I have paid button
    const paidBtn = document.getElementById('paidBtn');
    if (paidBtn) {
        paidBtn.addEventListener('click', async () => {
            paymentModal.classList.remove('active');
            loadingOverlay.classList.add('active');
            await registerSlot(currentRegistration);
            loadingOverlay.classList.remove('active');
        });
    }

    // Close success modal
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            successModal.classList.remove('active');
        });
    }

    // Close on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', () => {
            paymentModal.classList.remove('active');
            successModal.classList.remove('active');
        });
    });
}

// Register slot (sends to backend)
async function registerSlot(data) {
    try {
        const response = await fetch('/api/register-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Registration failed');
        }

        // Show success modal
        document.getElementById('successModal').classList.add('active');

        // Reset form
        document.getElementById('registrationForm').reset();

    } catch (error) {
        alert(error.message);
    }
}
