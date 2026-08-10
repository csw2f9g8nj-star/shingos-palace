const formidableLibrary = require("formidable");
const createFormidable = formidableLibrary.formidable || formidableLibrary;

function parseMultipartForm(req) {
  const form = createFormidable({
    multiples: true,
    maxFileSize: 10 * 1024 * 1024,
    maxTotalFileSize: 50 * 1024 * 1024,
    allowEmptyFiles: false,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        error.statusCode = 400;
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

function toFileArray(fileValue) {
  if (!fileValue) return [];
  return Array.isArray(fileValue) ? fileValue.filter(Boolean) : [fileValue];
}

module.exports = {
  parseMultipartForm,
  toFileArray,
};
