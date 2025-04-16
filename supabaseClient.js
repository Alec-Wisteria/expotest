import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.0.0/+esm';

const supabaseUrl = 'https://kiwuzfwvrahadfearfcs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpd3V6Znd2cmFoYWRmZWFyZmNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3Njc2NTIsImV4cCI6MjA2MDM0MzY1Mn0.8sI-kWhIsMf_u_QaH5mLmo66oPjZhNspNjUOjmAlYZo'; 
export const supabase = createClient(supabaseUrl, supabaseKey);

// Ensure the 'products' table exists in your Supabase database with columns:
// id (auto-increment), name (text), price (float), quantity (integer), category (text), image (text)

// Example schema for 'products' table:
// CREATE TABLE products (
//   id SERIAL PRIMARY KEY,
//   name TEXT NOT NULL,
//   price FLOAT NOT NULL,
//   quantity INT NOT NULL,
//   category TEXT NOT NULL,
//   image TEXT NOT NULL
// );

// Ensure the 'product-images' storage bucket exists in your Supabase project.
// You can create it via the Supabase dashboard under "Storage" -> "Create Bucket".

// Example usage of the storage bucket:
// supabase.storage.from('product-images').upload('fileName', fileContent);

// Real-time subscription to profiles table
supabase.channel('public:profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
        console.log('Change received!', payload);
        // Handle the real-time update here
    })
    .subscribe();

// Function to sign up a user and insert data into profiles table
export async function signUpUser(username, email, password, confirmPassword) {
    if (password !== confirmPassword) {
        console.log("Passwords do not match");
        return false;
    }

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        console.log("Error signing up:", error.message);
        return false;
    }

    console.log("User signed up successfully:", data);

    // If user is null, wait until they confirm their email before inserting profile
    if (!data.user) {
        alert("Confirmation email sent. Please verify your email before signing in.");
        return true;
    }

    const { error: insertError } = await supabase
        .from('profiles')
        .insert([
            { id: data.user.id, username: username, email: email }
        ]);

    if (insertError) {
        console.log("Error inserting into profiles table:", insertError.message);
        return false;
    }

    console.log("Data inserted into profiles table successfully");
    return true;
}


// Function to sign in a user and check if they exist in the profiles table
export async function signInUser(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        console.log("Error signing in:", error.message);
        return false;
    }

    console.log("User signed in successfully:", data);

    // Check if the user exists in the profiles table
    const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

    if (profileError) {
        console.log("Error checking profiles table:", profileError.message);
        return false;
    }

    console.log("User exists in profiles table:", profileData);
    return true;
}

export async function getUserType() {
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.session || !session.session.user) {
        console.log("No user session found or error fetching session:", sessionError?.message);
        return null; // Return null if no session or user is found
    }

    const userId = session.session.user.id;

    if (!userId) {
        console.log("User ID is undefined");
        return null; // Return null if userId is undefined
    }

    const { data: profileData, error } = await supabase
        .from('profiles')
        .select('user_type')
        .eq('id', userId)
        .single();

    if (error) {
        console.log("Error fetching user type:", error.message);
        return null;
    }

    return profileData.user_type;
}

export async function uploadProduct(product) {
    const { name, price, quantity, category } = product;

    const { data: session, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.session || !session.session.user) {
        console.log("User is not authenticated:", sessionError?.message);
        return { success: false, message: "User is not authenticated" };
    }

    const userId = session.session.user.id;

    const { error: insertError } = await supabase
        .from('products')
        .insert([
            {
                name,
                price,
                quantity, // Use quantity here
                category,
                user_id: userId
            }
        ]);

    if (insertError) {
        console.log("Error inserting product:", insertError.message);
        return { success: false, message: "Error inserting product" };
    }

    console.log("Product uploaded successfully");
    return { success: true, message: "Product uploaded successfully" };
}

/**
 * Resizes an image to a fixed size of 250x250px.
 * @param {File} imageFile - The image file to resize.
 * @returns {Promise<File>} - A resized image file.
 */
async function resizeImage(imageFile) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const fixedSize = 250; // Fixed size for both width and height
                canvas.width = fixedSize;
                canvas.height = fixedSize;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, fixedSize, fixedSize);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const resizedFile = new File([blob], imageFile.name, {
                            type: imageFile.type,
                            lastModified: Date.now(),
                        });
                        resolve(resizedFile);
                    } else {
                        reject(new Error('Failed to resize image.'));
                    }
                }, imageFile.type);
            };
            img.src = event.target.result;
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(imageFile);
    });
}

/**
 * Uploads an image to the 'product-images' bucket and returns the public URL.
 * Resizes the image to a maximum of 500x500px before uploading.
 * @param {File} imageFile - The image file to upload.
 * @param {string} userId - The ID of the user uploading the image.
 * @returns {Promise<string|null>} - The public URL of the uploaded image or null if an error occurs.
 */
export async function uploadProductImage(imageFile, userId) {
    try {
        const resizedImage = await resizeImage(imageFile);
        const sanitizedFileName = resizedImage.name.replace(/[^a-zA-Z0-9.\-_]/g, '_'); // Replace invalid characters
        const imagePath = `${userId}/${Date.now()}_${sanitizedFileName}`;
        const { error: uploadError } = await supabase.storage
            .from('product-images')
            .upload(imagePath, resizedImage);

        if (uploadError) {
            console.error('Error uploading image:', uploadError.message);
            return null;
        }

        const { data: publicUrlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(imagePath);

        return publicUrlData?.publicUrl || null;
    } catch (error) {
        console.error('Error resizing or uploading image:', error.message);
        return null;
    }
}

/**
 * Notifies the buyer and updates their orders based on the seller's actions.
 * @param {string} orderId - The ID of the order.
 * @param {string} status - The updated status of the order.
 */
export async function notifyBuyerAndUpdateOrders(orderId, status) {
    try {
        // Fetch the buyer's ID from the order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('buyer_id')
            .eq('id', orderId)
            .single();

        if (orderError) {
            console.error('Error fetching order details:', orderError.message);
            return;
        }

        // Insert a notification for the buyer
        const { error: notificationError } = await supabase
            .from('notifications')
            .insert([{
                user_id: order.buyer_id,
                message: `Your order status has been updated to "${status}".`,
                order_id: orderId,
            }]);

        if (notificationError) {
            console.error('Error notifying buyer:', notificationError.message);
        }

        // Update the order status
        const { error: orderUpdateError } = await supabase
            .from('orders')
            .update({ status })
            .eq('id', orderId);

        if (orderUpdateError) {
            console.error('Error updating order status:', orderUpdateError.message);
        }
    } catch (error) {
        console.error('Unexpected error in notifyBuyerAndUpdateOrders:', error.message);
    }
}

/**
 * Fetches chat messages between the current user and another user.
 * @param {string} otherUserId - The ID of the other user.
 * @returns {Promise<Array>} - An array of messages.
 */
export async function fetchMessages(otherUserId) {
    const { data: session } = await supabase.auth.getSession();
    if (!session || !session.session || !session.session.user) return [];

    const userId = session.session.user.id;

    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .and(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching messages:', error.message);
        return [];
    }

    return messages;
}

/**
 * Sends a chat message.
 * @param {string} receiverId - The ID of the receiver.
 * @param {string} content - The message content.
 * @returns {Promise<boolean>} - True if the message was sent successfully.
 */
export async function sendMessage(receiverId, content) {
    const { data: session } = await supabase.auth.getSession();
    if (!session || !session.session || !session.session.user) return false;

    const userId = session.session.user.id;

    const { error } = await supabase
        .from('messages')
        .insert([{ sender_id: userId, receiver_id: receiverId, content }]);

    if (error) {
        console.error('Error sending message:', error.message);
        return false;
    }

    return true;
}

/**
 * Fetches chat participants for the current user.
 * @returns {Promise<Array>} - An array of chat participants.
 */
export async function fetchChatParticipants() {
    const { data: session } = await supabase.auth.getSession();
    if (!session || !session.session || !session.session.user) return [];

    const userId = session.session.user.id;

    const { data: participants, error } = await supabase
        .from('messages')
        .select(`
            sender_id,
            receiver_id,
            sender_profile:profiles!messages_sender_id_fkey(username, profile_picture),
            receiver_profile:profiles!messages_receiver_id_fkey(username, profile_picture)
        `)
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching chat participants:', error.message);
        return [];
    }

    // Filter unique participants
    const uniqueParticipants = new Map();
    participants.forEach((message) => {
        const otherUserId = message.sender_id === userId ? message.receiver_id : message.sender_id;
        const profile =
            message.sender_id === userId
                ? message.receiver_profile
                : message.sender_profile;

        if (!uniqueParticipants.has(otherUserId)) {
            uniqueParticipants.set(otherUserId, { otherUserId, profile });
        }
    });

    return Array.from(uniqueParticipants.values());
}

