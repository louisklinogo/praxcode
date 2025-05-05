// This is a test file for PraxCode

function calculateSum(a, b) {
    return a + b;
}

function calculateProduct(a, b) {
    return a * b;
}

function calculateDifference(a, b) {
    return a - b;
}

function calculateQuotient(a, b) {
    if (b === 0) {
        throw new Error("Division by zero");
    }
    return a / b;
}

// Test the functions
console.log(calculateSum(5, 3));       // 8
console.log(calculateProduct(5, 3));   // 15
console.log(calculateDifference(5, 3)); // 2
console.log(calculateQuotient(6, 2));  // 3
