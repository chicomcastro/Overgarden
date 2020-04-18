using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Player : MonoBehaviour
{
    public float maxStamina = 100f;
    public float currentStamina;
    public StaminaBar staminaBar;
    Vector2 direction;
    public float speed;
    public float runSpeed;
    public float normalSpeed;
    public float regen;

    public Rigidbody2D rigidbody;
    public Animator animator;

    public bool IsMoving
    {
        get
        {
            return direction.x != 0 || direction.y !=0;
        }
    }
    
    // Start is called before the first frame update
    void Start()
    {
        currentStamina = maxStamina;
        staminaBar.SetMaxStamina(maxStamina);
        rigidbody = GetComponent<Rigidbody2D>();
        animator = GetComponent<Animator>();

    }

    // Update is called once per frame
    void Update()
    {
        rigidbody.velocity = direction.normalized * speed;
        GetInput();

         if (IsMoving)
        {
            ActivateLayer("Walk Layer");
            animator.SetFloat("x", direction.x);
            animator.SetFloat("y", direction.y);    
        }
        else
        {
            ActivateLayer("Idle Layer");
        }


        if (currentStamina > maxStamina)
        {
            currentStamina = maxStamina;
        }
        if (currentStamina < 0)
        {
            currentStamina = 0;
        }

    }
    
    public void GetInput()
    {
        direction = Vector2.zero;

        if (Input.GetKey(KeyCode.W))
        {
            direction += Vector2.up;
        }
        if (Input.GetKey(KeyCode.S))
        {
            direction += Vector2.down;
        }
        if (Input.GetKey(KeyCode.A))
        {
            direction += Vector2.left;
        }
        if (Input.GetKey(KeyCode.D))
        {
            direction += Vector2.right;
        }


        if (Input.GetKey(KeyCode.LeftShift) && IsMoving)
        {
            speed = runSpeed;
            currentStamina -= 0.8f;
            staminaBar.SetStamina(currentStamina);

            if (currentStamina <= 0)
            {
                speed = normalSpeed;
            }
        }
        else
        {
            speed = normalSpeed;
            currentStamina += regen * Time.deltaTime;
            staminaBar.SetStamina(currentStamina);
        }
    }

    public void ActivateLayer(string layerName)
    {
        for(int i=0; i < animator.layerCount; i++)
        {
            animator.SetLayerWeight(i, 0);
        }

        animator.SetLayerWeight(animator.GetLayerIndex(layerName),1);
    }


}
