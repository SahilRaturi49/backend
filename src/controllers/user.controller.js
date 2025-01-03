import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"


const generateAccessAndRefereshTokens = async(userId) =>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return {accessToken, refreshToken}


    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating referesh and access token")
    }
}

const registerUser = asyncHandler(async(req, res) => {
    // get user details from fronted
    // validation - not empty
    // check if user already exists: username, email
    // check for images, check for avatar
    // upload the to cloudinary, avatar
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation 
    // return response


    // user details are collected by using request
    const {fullName, email, username, password} = req.body
    // console.log("email: ", email);

    if(
        [fullName, email, username, password].some( (field) => 
            field?.trim() ==="")
    ){
        throw new ApiError(400, "All fields are required")
    }

   const existedUser = await User.findOne({
        $or: [{ username },{ email }]
    })

    if(existedUser){
        throw new ApiError(409, "User with email or username already exist")
    }

    // console.log(req.files); 
    

    const avatarLocalPath = req.files?.avatar[0]?.path;
    
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) &&
        req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!avatar){
        throw new ApiError(400, "Avatar file is required")
    }
    

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )
})


const loginUser = asyncHandler(async(req,res) =>{

    // req body --> data
    // username or email
    // find the user
    // password check
    // access and refresh token
    // send cookie


    //user details are collected using req body
    const {email, username, password} = req.body
    console.log(email);
    

    // we check whether the user is providing username an email
    // if (!(username || email)) {
    //     throw new ApiError(400, "username or email is required")
    // }

    if(!username || !email){
        if(!username && !email){
            throw new ApiError(400, "username or email is required")
        }
    }

    const user = await User.findOne({
         $or: [{username}, {email}]
    })

    if (!user) {
        throw new ApiError(404, "User does not exist")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials")
    }

    const {accessToken, refreshToken} = await generateAccessAndRefereshTokens(user._id)


    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    // sending cookies
    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshtoken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
               user: loggedInUser, accessToken, refreshToken  
            },
            "User Logged in successfully"
        )
    )



})


// to logout a user we will clear the cookies and 
// we have to reset refresh token
const logoutUser = asyncHandler(async(req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            // mongodb operator 
            // set will give a objecct and update all the values provided to set
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
        
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshtoken", options)
    .json(new ApiResponse(200, {}, "User logged Out"))
    
})

// refresh access token end point
const refreshAccessToken = asyncHandler(async(req, res) =>{
    // calling refresh token
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401, "unauthorized request")
    }

    // we have to verify the incoming token
    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
    
        const user = await User.findById(decodedToken?._id)
    
        if(!user){
            throw new ApiError(401, "Invalid refresh token")
        }
    
        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401, "refresh token is expired or used")
        }
    
        const options = {
            httpOnly: true,
            secure: true
        }
    
        const {accessToken, newRefreshToken} = await generateAccessAndRefereshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken",accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, newRefreshToken: newRefreshToken},
                "Access token refreshed"
            )
        )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

const changecurrentPassword = asyncHandler(async(req, res) => {

    const {oldPassword, newPassword} = req.body
    
    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400, "Invalid password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})
    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async(req,res) => {
    return res
    .status(200)
    .json(200, req.user, "current user fetched successfully")
})

const updateaccountdetails = asyncHandler(async(req, res) =>{
    const {fullName, email} = req.body

    if(!fullName || !email){
        throw new ApiError(400, "All fields are required")
    }

    const user = User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullName,
                email,

            }
        },
        {new: true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async(req, res) =>{

    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading on avatar")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {new: true}
    ).select("-password")
    return res
    .status(200)
    .json(
        new ApiResponse(200, user, "Avatar updateed succefully")
    )
})
const updateUserCoverImage = asyncHandler(async(req, res) =>{

    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "Cover Image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading on cover image")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {new: true}
    ).select("-password")

    return res
    .status(200)
    .json(
        new ApiResponse(200, user, "Cover image updateed succefully")
    )
})



export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changecurrentPassword,
    getCurrentUser,
    updateaccountdetails,
    updateUserAvatar,
    updateUserCoverImage
} 