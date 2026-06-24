// import cloudinary from "../../config/cloudinary.js";
// import logger from "../../utils/logger.js";

// export const uploadImage = async (fileBuffer, folder = "portfolio-cms") => {
//   logger.info(
//     {
//       folder,
//     },
//     "Uploading image to Cloudinary",
//   );

//   return new Promise((resolve, reject) => {
//     cloudinary.uploader
//       .upload_stream(
//         {
//           folder,
//         },

//         (error, result) => {
//           if (error) {
//             logger.error(
//               {
//                 err: error,
//               },
//               "Cloudinary upload failed",
//             );

//             return reject(error);
//           }

//           logger.info(
//             {
//               publicId: result.public_id,
//             },
//             "Cloudinary upload successful",
//           );

//           resolve({
//             publicId: result.public_id,

//             url: result.secure_url,
//           });
//         },
//       )
//       .end(fileBuffer);
//   });
// };

// export const uploadImages = async (files, folder = "portfolio-cms") => {
//   const uploads = files.map((file) => uploadImage(file.buffer, folder));

//   return Promise.all(uploads);
// };


import cloudinary from "../../config/cloudinary.js";
import logger from "../../utils/logger.js";

const BASE_FOLDER = "portfolio-cms";

const getFolderPath = (folder = "misc") =>
  `${BASE_FOLDER}/${folder}`;

export const uploadImage = async (
  fileBuffer,
  folder = "misc"
) => {
  const folderPath = getFolderPath(folder);

  logger.info(
    { folder: folderPath },
    "Uploading image to Cloudinary"
  );

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: folderPath,
        },
        (error, result) => {
          if (error) {
            logger.error(
              { err: error },
              "Cloudinary upload failed"
            );

            return reject(error);
          }

          logger.info(
            {
              publicId: result.public_id,
            },
            "Cloudinary upload successful"
          );

          resolve({
            publicId: result.public_id,
            url: result.secure_url,
          });
        }
      )
      .end(fileBuffer);
  });
};

export const uploadImages = async (
  files,
  folder = "misc"
) => {
  return Promise.all(
    files.map((file) =>
      uploadImage(file.buffer, folder)
    )
  );
};

export const deleteImage = async (
  publicId
) => {
  logger.info(
    { publicId },
    "Deleting image from Cloudinary"
  );

  const result =
    await cloudinary.uploader.destroy(
      publicId
    );

  logger.info(
    {
      publicId,
      result: result.result,
    },
    "Image deleted"
  );

  return result;
};

export const replaceImage = async (
  oldPublicId,
  fileBuffer,
  folder = "misc"
) => {
  logger.info(
    {
      oldPublicId,
    },
    "Replacing image"
  );

  const newImage = await uploadImage(
    fileBuffer,
    folder
  );

  if (oldPublicId) {
    await deleteImage(oldPublicId);
  }

  return newImage;
};

export const getOptimizedUrl = (
  publicId,
  options = {}
) => {
  const {
    width = 1200,
    quality = "auto",
    fetchFormat = "auto",
  } = options;

  return cloudinary.url(publicId, {
    width,
    crop: "scale",
    quality,
    fetch_format: fetchFormat,
  });
};